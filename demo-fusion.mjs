// demo-fusion.mjs — identity resolution: a SECOND type (planetar:Detection,
// no MMSI) resolved against planetar:Vessel by the generic engine. This is
// dark-vessel re-identification in miniature — the CH13 flagship scenario.
//   run:  node demo-fusion.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadRegistry } from './src/registry.mjs';
import { adaptAisVessel } from './src/adapter-ais.mjs';
import { adaptSarDetection } from './src/adapter-sar.mjs';
import { resolve } from './src/resolve.mjs';
import { jsonEncode, jsonDecode, binaryEncodeBody, binaryDecodeBody, zmesgEncodeFrame, zmesgDecodeFrame } from './src/codecs.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
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
const check = (name, ok, extra = '') => { (ok ? pass++ : fail++); console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? `   ${extra}` : ''}`); };
const report = (r) => {
  const o = r.obs;
  console.log(`  observation: ${o.kernel.type}  @ (${o.body.lat}, ${o.body.lon})  t=${o.kernel.ts}`);
  if (!r.candidates.length) console.log('    candidates: none');
  for (const c of r.candidates) {
    console.log(`    candidate ${c.entity.body.name}  score ${c.score.toFixed(3)}  [${c.reasons.join('; ')}]`);
  }
  const dark = r.action === 'new' && o.kernel.type === 'planetar:Detection';
  console.log(`    => ${r.action.toUpperCase()}${dark ? '   *** DARK VESSEL candidate ***' : ''}`);
};

const model = loadRegistry();

console.log('\n=== known fleet: two AIS vessels become canonical entities ===');
const aisRaw = JSON.parse(readFileSync(join(HERE, 'sample', 'ais-vessel.json'), 'utf8'));
const v1 = adaptAisVessel(aisRaw); // PACIFIC VOYAGER, mmsi 316001234
const v2 = adaptAisVessel({ ...aisRaw, mmsi: 316005678, name: 'COASTAL RANGER', callsign: 'VGCR', lat: 48.5000, lon: -123.4000 });
const fleet = [v1, v2];
for (const v of fleet) console.log(`  ${v.body.name}  mmsi ${v.body.mmsi}  @ (${v.body.lat}, ${v.body.lon})`);

console.log('\n=== Scenario A: AIS re-observation — resolves by exact MMSI ===');
const reObs = adaptAisVessel(aisRaw); // same mmsi 316001234, fresh message
const rA = resolve(reObs, fleet, model);
report(rA);
check('A: exact MMSI match -> MERGE onto PACIFIC VOYAGER', rA.action === 'merge' && rA.top?.entity === v1);

console.log('\n=== Scenario B: SAR detection near a known vessel — corroboration ===');
const sar = JSON.parse(readFileSync(join(HERE, 'sample', 'sar-detections.json'), 'utf8')).detections;
const detA = adaptSarDetection(sar[0]);
const rB = resolve(detA, fleet, model);
report(rB);
check('B: SAR blob (no MMSI) near a vessel -> REVIEW, top is PACIFIC VOYAGER',
  rB.action === 'review' && rB.top?.entity === v1 && rB.candidates.length === 1);

console.log('\n=== Scenario C: SAR detection, no AIS within 2 km — DARK VESSEL ===');
const detB = adaptSarDetection(sar[1]);
const rC = resolve(detB, fleet, model);
report(rC);
check('C: SAR blob with no candidate -> NEW (dark vessel candidate)',
  rC.action === 'new' && rC.candidates.length === 0);

console.log('\n=== Detection type round-trips all codecs (json-repr bbox_px) ===');
check('Detection round-trips JSON', eq(jsonDecode(jsonEncode(detA, model), model), detA));
const fr = zmesgDecodeFrame(zmesgEncodeFrame(detA.kernel, binaryEncodeBody(detA, model)));
check('Detection body round-trips binary incl. bbox_px array',
  eq(binaryDecodeBody(fr.payload, model, detA.kernel.type), detA.body));

console.log(`\n=== ${fail === 0 ? 'ALL PASS' : 'FAILURES'} : ${pass} passed, ${fail} failed ===\n`);
process.exit(fail === 0 ? 0 : 1);
