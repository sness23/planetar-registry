// codecs.mjs — the three encodings of one canonical entity, plus the zmesg
// frame. An entity in memory is { kernel, body, provenance }.
//   kernel.ts and any uint64 body field are BigInt in memory.
//   JSON / markdown carry uint64 as strings (53-bit float safety).
//   binary carries a real u64.
const enc = new TextEncoder();
const dec = new TextDecoder();

const KERNEL_KEYS = ['id', 'type', 'ts', 'topic', 'source', 'schema_version', 'correlation_id', 'causation_id'];

const uint64Fields = (model, typeName) =>
  new Set(model.type(typeName).fields.filter((f) => f.repr === 'uint64').map((f) => f.key));

// ── plain (JSON-safe) form: BigInt -> string ───────────────────────────────
function entityToPlain(e, model) {
  const u64 = uint64Fields(model, e.kernel.type);
  const body = {};
  for (const [k, v] of Object.entries(e.body)) body[k] = u64.has(k) ? String(v) : v;
  const prov = {};
  for (const [k, p] of Object.entries(e.provenance || {})) prov[k] = { ...p, ts: String(p.ts) };
  return { kernel: { ...e.kernel, ts: String(e.kernel.ts) }, body, _provenance: prov };
}
function entityFromPlain(p, model) {
  const u64 = uint64Fields(model, p.kernel.type);
  const body = {};
  for (const [k, v] of Object.entries(p.body)) body[k] = u64.has(k) && v !== null ? BigInt(v) : v;
  const prov = {};
  for (const [k, pr] of Object.entries(p._provenance || {})) prov[k] = { ...pr, ts: BigInt(pr.ts) };
  return { kernel: { ...p.kernel, ts: BigInt(p.kernel.ts) }, body, provenance: prov };
}

// ── JSON (warm path: WS bridge, REST) ──────────────────────────────────────
export const jsonEncode = (e, model) => JSON.stringify(entityToPlain(e, model));
export const jsonDecode = (s, model) => entityFromPlain(JSON.parse(s), model);

// ── markdown + YAML frontmatter (cold path: vault, audit) ──────────────────
// Each frontmatter value is a JSON literal — a strict, round-trip-safe subset
// of YAML that needs no YAML library.
export function markdownEncode(e, model) {
  const p = entityToPlain(e, model);
  const lines = ['---'];
  for (const k of KERNEL_KEYS) lines.push(`${k}: ${JSON.stringify(p.kernel[k])}`);
  for (const [k, v] of Object.entries(p.body)) lines.push(`${k}: ${JSON.stringify(v)}`);
  lines.push(`_provenance: ${JSON.stringify(p._provenance)}`);
  lines.push('---', '', `# ${p.body.name ?? p.kernel.id}`, '');
  return lines.join('\n');
}
export function markdownDecode(s, model) {
  const fm = s.split('---')[1];
  const kernel = {}; const body = {}; let prov = {};
  for (const line of fm.split('\n')) {
    const i = line.indexOf(': ');
    if (i < 0) continue;
    const key = line.slice(0, i);
    const val = JSON.parse(line.slice(i + 2));
    if (key === '_provenance') prov = val;
    else if (KERNEL_KEYS.includes(key)) kernel[key] = val;
    else body[key] = val;
  }
  return entityFromPlain({ kernel, body, _provenance: prov }, model);
}

// ── binary body (hot path: the zmesg payload) ──────────────────────────────
// record = [u32 gid][u8 wire-type][value].  wire-type: 0 null 1 int64 2 f64
// 3 string 4 bool 5 uint64.  Numeric gids keep zmesg's zero-copy parse intact.
const WT = { null: 0, int: 1, double: 2, string: 3, bool: 4, uint64: 5, json: 6 };

export function binaryEncodeBody(e, model) {
  const t = model.type(e.kernel.type);
  const byKey = new Map(t.fields.map((f) => [f.key, f]));
  const recs = [];
  for (const [k, v] of Object.entries(e.body)) {
    const f = byKey.get(k);
    if (!f) throw new Error(`binary: field ${k} not in registry for ${t.name}`);
    recs.push({ gid: f.gid, repr: f.repr, val: v });
  }
  let size = 2;
  for (const r of recs) {
    size += 5;
    if (r.val === null || r.val === undefined) continue;
    if (r.repr === 'string') size += 4 + enc.encode(r.val).length;
    else if (r.repr === 'json') size += 4 + enc.encode(JSON.stringify(r.val)).length;
    else if (r.repr === 'bool') size += 1;
    else size += 8;
  }
  const buf = new Uint8Array(size);
  const dv = new DataView(buf.buffer);
  let o = 0;
  dv.setUint16(o, recs.length, true); o += 2;
  for (const r of recs) {
    dv.setUint32(o, r.gid, true); o += 4;
    const nul = r.val === null || r.val === undefined;
    dv.setUint8(o, nul ? WT.null : WT[r.repr]); o += 1;
    if (nul) continue;
    if (r.repr === 'int') { dv.setBigInt64(o, BigInt(r.val), true); o += 8; }
    else if (r.repr === 'uint64') { dv.setBigUint64(o, BigInt(r.val), true); o += 8; }
    else if (r.repr === 'double') { dv.setFloat64(o, r.val, true); o += 8; }
    else if (r.repr === 'bool') { dv.setUint8(o, r.val ? 1 : 0); o += 1; }
    else if (r.repr === 'json') { const b = enc.encode(JSON.stringify(r.val)); dv.setUint32(o, b.length, true); o += 4; buf.set(b, o); o += b.length; }
    else { const b = enc.encode(r.val); dv.setUint32(o, b.length, true); o += 4; buf.set(b, o); o += b.length; }
  }
  return buf;
}

export function binaryDecodeBody(buf, model, typeName) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let o = 0;
  const count = dv.getUint16(o, true); o += 2;
  const body = {};
  for (let i = 0; i < count; i++) {
    const g = dv.getUint32(o, true); o += 4;
    const wt = dv.getUint8(o); o += 1;
    const f = model.fieldByGid(typeName, g); // type-scoped: envelope named the type
    if (!f) throw new Error(`binary: unknown field-id 0x${g.toString(16)} in ${typeName}`);
    let val;
    if (wt === WT.null) val = null;
    else if (wt === WT.int) { val = Number(dv.getBigInt64(o, true)); o += 8; }
    else if (wt === WT.uint64) { val = dv.getBigUint64(o, true); o += 8; }
    else if (wt === WT.double) { val = dv.getFloat64(o, true); o += 8; }
    else if (wt === WT.bool) { val = dv.getUint8(o) === 1; o += 1; }
    else if (wt === WT.json) { const len = dv.getUint32(o, true); o += 4; val = JSON.parse(dec.decode(buf.subarray(o, o + len))); o += len; }
    else { const len = dv.getUint32(o, true); o += 4; val = dec.decode(buf.subarray(o, o + len)); o += len; }
    body[f.key] = val;
  }
  return body;
}

// ── zmesg envelope frame (the kernel on the wire) ──────────────────────────
const MAGIC = 0x5a4d5347;
const FIXED = 66;
const hexToBytes = (h) => Uint8Array.from(h.match(/../g).map((x) => parseInt(x, 16)));
const bytesToHex = (b) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
const packSemver = (s) => { const [a, b, c] = s.split('.').map(Number); return ((a << 16) | (b << 8) | c) >>> 0; };
const unpackSemver = (n) => `${(n >> 16) & 0xff}.${(n >> 8) & 0xff}.${n & 0xff}`;

export function zmesgEncodeFrame(kernel, payload) {
  const topic = enc.encode(kernel.topic);
  const source = enc.encode(kernel.source);
  const schemaName = enc.encode(kernel.type);
  const corr = enc.encode(kernel.correlation_id || '');
  const caus = enc.encode(kernel.causation_id || '');
  const headerLen = FIXED + topic.length + source.length + schemaName.length + corr.length + caus.length;
  const env = new Uint8Array(headerLen + payload.length);
  const dv = new DataView(env.buffer);
  dv.setUint32(0, MAGIC, true);
  dv.setUint8(4, 1);
  dv.setUint16(6, headerLen, true);
  env.set(hexToBytes(kernel.id), 8);
  dv.setBigUint64(24, kernel.ts, true);
  dv.setBigUint64(32, kernel.ts, true);
  dv.setBigUint64(40, kernel.ts, true);
  dv.setUint16(48, topic.length, true);
  dv.setUint16(50, source.length, true);
  dv.setUint16(52, schemaName.length, true);
  dv.setUint16(54, corr.length, true);
  dv.setUint16(56, caus.length, true);
  dv.setUint32(58, packSemver(kernel.schema_version), true);
  dv.setUint32(62, payload.length, true);
  let o = FIXED;
  for (const s of [topic, source, schemaName, corr, caus]) { env.set(s, o); o += s.length; }
  env.set(payload, headerLen);
  // TCP frame: 4-byte BE length prefix + envelope
  const frame = new Uint8Array(4 + env.length);
  new DataView(frame.buffer).setUint32(0, env.length, false); // big-endian
  frame.set(env, 4);
  return frame;
}

export function zmesgDecodeFrame(frame) {
  const flen = new DataView(frame.buffer, frame.byteOffset).getUint32(0, false);
  const env = frame.subarray(4, 4 + flen);
  const dv = new DataView(env.buffer, env.byteOffset, env.byteLength);
  if (dv.getUint32(0, true) !== MAGIC) throw new Error('zmesg: bad magic');
  const headerLen = dv.getUint16(6, true);
  const id = bytesToHex(env.subarray(8, 24));
  const ts = dv.getBigUint64(24, true);
  const lens = [48, 50, 52, 54, 56].map((off) => dv.getUint16(off, true));
  const schemaVersion = unpackSemver(dv.getUint32(58, true));
  const payloadLen = dv.getUint32(62, true);
  let o = FIXED;
  const take = (n) => { const s = dec.decode(env.subarray(o, o + n)); o += n; return s; };
  const [topic, source, type, correlation_id, causation_id] = lens.map(take);
  const payload = env.subarray(headerLen, headerLen + payloadLen);
  return { kernel: { id, type, ts, topic, source, schema_version: schemaVersion, correlation_id, causation_id }, payload };
}
