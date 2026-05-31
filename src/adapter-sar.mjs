// adapter-sar.mjs — source adapter: raw planetar-sat SAR detection JSON ->
// canonical planetar:Detection entity. Versioned (src:planetar-sat@<version>).
export const ADAPTER_VERSION = '1.0.0';

function uuid7Hex() {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  const ms = BigInt(Date.now());
  for (let i = 0; i < 6; i++) b[i] = Number((ms >> BigInt(8 * (5 - i))) & 0xffn);
  b[6] = (b[6] & 0x0f) | 0x70;
  b[8] = (b[8] & 0x3f) | 0x80;
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

export function adaptSarDetection(raw) {
  const acquiredAt = BigInt(raw.acquired_at_ns); // string -> BigInt (53-bit-safe)
  // snr -> confidence: a crude normalisation. The real calibration (so SAR snr
  // is comparable to AIS / EO confidence) is spec §12 open question.
  const confidence = Number(Math.min(1, raw.snr / 20).toFixed(4));
  const body = {
    scene_id: raw.scene_id,
    lat: raw.lat,
    lon: raw.lon,
    snr: raw.snr,
    bbox_px: raw.bbox_px,
    acquired_at_ns: acquiredAt,
    confidence,
  };
  const src = `src:planetar-sat@${ADAPTER_VERSION}`;
  const obs = `obs_${uuid7Hex().slice(0, 16)}`;
  const provenance = {};
  for (const k of Object.keys(body)) provenance[k] = { obs, src, conf: confidence, ts: acquiredAt };
  const kernel = {
    id: uuid7Hex(),
    type: 'planetar:Detection',
    ts: acquiredAt,
    topic: `entity.detection.${raw.scene_id.slice(-12)}`,
    source: src,
    schema_version: '1.0.0',
    correlation_id: '',
    causation_id: '',
  };
  return { kernel, body, provenance };
}
