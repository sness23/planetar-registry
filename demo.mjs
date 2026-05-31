// demo.mjs — vertical slice for planetar:Vessel.
// registry -> codegen (4 artifacts) -> adapt a real planetar-ais payload ->
// round-trip it through all three encodings -> validate -> extension -> governance.
//   run:  node demo.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadRegistry } from './src/registry.mjs';
import { genJsonSchema, genFieldDict, genTypeScript, genSqlDdl } from './src/codegen.mjs';
import { validate } from './src/validate.mjs';
import { adaptAisVessel } from './src/adapter-ais.mjs';
import {
  jsonEncode, jsonDecode, markdownEncode, markdownDecode,
  binaryEncodeBody, binaryDecodeBody, zmesgEncodeFrame, zmesgDecodeFrame,
} from './src/codecs.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const show = (v) => JSON.stringify(v, (k, x) => (typeof x === 'bigint' ? `${x}` : x), 2);
const eq = (a, b) => {
  if (typeof a === 'bigint' || typeof b === 'bigint') return typeof a === typeof b && a === b;
  if (a === b) return true;
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const ka = Object.keys(a), kb = Object.keys(b);
    return ka.length === kb.length && ka.every((k) => eq(a[k], b[k]));
  }
  return false;
};
let pass = 0, fail = 0;
const check = (name, ok, extra = '') => {
  (ok ? pass++ : fail++);
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? `   ${extra}` : ''}`);
};

console.log('\n=== 1. load registry (git-vault SSOT -> in-memory model) ===');
const model = loadRegistry();
const T = model.type('planetar:Vessel');
console.log(`  ${[...model.types.keys()].join(', ')}  |  ${T.fields.length} fields ` +
  `(${T.fields.filter((f) => f.core).length} core + ${T.fields.filter((f) => !f.core).length} extension)`);
console.log(`  field-ids: mmsi=0x${T.fields[0].gid.toString(16)}  ` +
  `acme:hull_temp_c=0x${T.fields.find((f) => !f.core).gid.toString(16)}`);

console.log('\n=== 2. codegen: one registry entry -> four artifacts ===');
mkdirSync(join(HERE, 'gen'), { recursive: true });
const schema = genJsonSchema(T);
const arts = {
  'planetar.Vessel.schema.json': JSON.stringify(schema, null, 2),
  'planetar.Vessel.fields.json': JSON.stringify(genFieldDict(T), null, 2),
  'planetar.Vessel.ts': genTypeScript(T),
  'planetar.Vessel.sql': genSqlDdl(T),
};
for (const [f, c] of Object.entries(arts)) {
  writeFileSync(join(HERE, 'gen', f), c);
  console.log(`  wrote gen/${f}  (${c.length} bytes)`);
}

console.log('\n=== 3. source adapter: raw planetar-ais JSON -> canonical entity ===');
const raw = JSON.parse(readFileSync(join(HERE, 'sample', 'ais-vessel.json'), 'utf8'));
const entity = adaptAisVessel(raw);
console.log(`  kernel: ${show(entity.kernel)}`);
console.log(`  body.vessel_class = ${JSON.stringify(entity.body.vessel_class)}  ` +
  `(was payload.type="${raw.type}" — collision renamed)`);
console.log(`  body.length_m = ${entity.body.length_m}  (was payload.length — units made explicit)`);
console.log(`  provenance[mmsi] = ${show(entity.provenance.mmsi)}`);

console.log('\n=== 4. round-trip through three encodings ===');
// JSON (warm path)
const j = jsonEncode(entity, model);
check('JSON encode -> decode preserves entity', eq(jsonDecode(j, model), entity));
// markdown (cold path)
const md = markdownEncode(entity, model);
check('markdown encode -> decode preserves entity', eq(markdownDecode(md, model), entity));
// binary body inside a zmesg frame (hot path)
const payload = binaryEncodeBody(entity, model);
const frame = zmesgEncodeFrame(entity.kernel, payload);
const { kernel: kBack, payload: pBack } = zmesgDecodeFrame(frame);
const bodyBack = binaryDecodeBody(pBack, model, kBack.type);
check('zmesg frame round-trips the kernel', eq(kBack, entity.kernel));
check('binary body encode -> decode preserves body', eq(bodyBack, entity.body));

const jsonBody = JSON.stringify(JSON.parse(j).body);
console.log(`  payload size:  JSON body ${Buffer.byteLength(jsonBody)} B  ->  ` +
  `binary body ${payload.length} B  (${Math.round((1 - payload.length / Buffer.byteLength(jsonBody)) * 100)}% smaller)`);
console.log(`  full zmesg TCP frame: ${frame.length} B (4 B BE len + 66 B header + strings + ${payload.length} B payload)`);

console.log('\n=== 5. validation against generated JSON Schema ===');
const v1 = validate(JSON.parse(j).body, schema);
check('canonical body validates', v1.ok, v1.errors.join('; '));

console.log('\n=== 6. third-party extension: acme adds a namespaced field ===');
const ext = structuredClone(entity);
ext.body['acme:hull_temp_c'] = 31.4;
ext.provenance['acme:hull_temp_c'] = { obs: 'obs_acme01', src: 'src:acme-thermal@0.2.0', conf: 0.8, ts: entity.kernel.ts };
const extBack = binaryDecodeBody(zmesgDecodeFrame(zmesgEncodeFrame(ext.kernel, binaryEncodeBody(ext, model))).payload, model, ext.kernel.type);
check('binary round-trips the namespaced extension field', eq(extBack['acme:hull_temp_c'], 31.4));
const v2 = validate(JSON.parse(jsonEncode(ext, model)).body, schema);
check('extended body validates (namespaced field passes core schema)', v2.ok, v2.errors.join('; '));

console.log('\n=== 7. governance: un-namespaced unknown field is rejected ===');
const bad = { ...JSON.parse(j).body, bogus_field: 1 };
const v3 = validate(bad, schema);
check('un-namespaced unknown field is rejected', !v3.ok, v3.errors.join('; '));

console.log(`\n=== ${fail === 0 ? 'ALL PASS' : 'FAILURES'} : ${pass} passed, ${fail} failed ===\n`);
process.exit(fail === 0 ? 0 : 1);
