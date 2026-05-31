// adapter-ais.mjs — source adapter: raw planetar-ais vessel JSON -> canonical
// planetar:Vessel entity. Adapters are VERSIONED (src:planetar-ais@<version>);
// a feed change ships a new adapter version, never a silent reinterpretation.
//
// This adapter does real work, which is the point: it renames `type`->
// `vessel_class` (kernel-field collision), renames `length`->`length_m` (units),
// camelCase->snake_case, lifts ns strings to BigInt, and stamps provenance.
export const ADAPTER_VERSION = '1.0.0';

function uuid7Hex() {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  const ms = BigInt(Date.now());
  for (let i = 0; i < 6; i++) b[i] = Number((ms >> BigInt(8 * (5 - i))) & 0xffn);
  b[6] = (b[6] & 0x0f) | 0x70; // version 7
  b[8] = (b[8] & 0x3f) | 0x80; // variant
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

export function adaptAisVessel(raw) {
  const lastSeen = BigInt(raw.lastSeenNs);
  const firstSeen = BigInt(raw.firstSeenNs);
  const body = {
    mmsi: raw.mmsi,
    name: raw.name,
    vessel_class: raw.type,            // collision rename: payload `type` vs kernel `type`
    flag: raw.flag ?? null,
    length_m: raw.length ?? null,      // unit rename: `length` -> `length_m`
    callsign: raw.callsign ?? null,
    lat: raw.lat,
    lon: raw.lon,
    sog: raw.sog,
    cog: raw.cog,
    heading: raw.heading,
    destination: raw.destination ?? null,
    last_seen_ns: lastSeen,
    first_seen_ns: firstSeen,
    in_bbox: raw.inBBox,
    confidence: 0.95,                  // AIS self-reported; synthetic constant — see README findings
  };
  const src = `src:planetar-ais@${ADAPTER_VERSION}`;
  const obs = `obs_${uuid7Hex().slice(0, 16)}`;
  const provenance = {};
  for (const k of Object.keys(body)) provenance[k] = { obs, src, conf: 0.95, ts: lastSeen };
  const kernel = {
    id: uuid7Hex(),
    type: 'planetar:Vessel',
    ts: lastSeen,
    topic: `entity.vessel.${raw.mmsi}`,
    source: src,
    schema_version: '1.0.0',
    correlation_id: '',
    causation_id: '',
  };
  return { kernel, body, provenance };
}
