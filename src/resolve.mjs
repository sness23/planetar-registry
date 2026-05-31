// resolve.mjs — generic identity resolution. The engine hardcodes no maritime
// logic: it reads the target type's `resolution` config from the registry.
// The same code resolves a SAR detection to a vessel (geo_time) and an AIS
// re-observation to a vessel (exact_id) — and, with an exact_id+fuzzy config,
// a researcher to a party. One engine, many domains (spec §5.2).
const R_EARTH_KM = 6371;
const toRad = (d) => (d * Math.PI) / 180;

function haversineKm(la1, lo1, la2, lo2) {
  const dLat = toRad(la2 - la1);
  const dLon = toRad(lo2 - lo1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(la1)) * Math.cos(toRad(la2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R_EARTH_KM * Math.asin(Math.sqrt(a));
}

// resolve one observation against existing canonical entities.
// returns { obs, candidates:[{entity,score,reasons}], top, action }
export function resolve(obs, candidates, model, targetType = 'planetar:Vessel') {
  const tdef = model.type(targetType);
  const cfg = tdef.resolution;
  if (!cfg) throw new Error(`${targetType} has no resolution config`);
  const obsSp = model.type(obs.kernel.type).spatial;
  const tgtSp = tdef.spatial;

  const scored = [];
  for (const c of candidates) {
    let score = 0;
    const reasons = [];
    for (const rule of cfg.rules) {
      if (rule.kind === 'exact_id') {
        const a = obs.body[rule.field];
        const b = c.body[rule.field];
        if (a != null && b != null && a === b) {
          score = Math.max(score, rule.score);
          reasons.push(`exact ${rule.field} match (${a})`);
        }
      } else if (rule.kind === 'geo_time') {
        if (!obsSp || !tgtSp) continue;
        const km = haversineKm(
          obs.body[obsSp.lat], obs.body[obsSp.lon],
          c.body[tgtSp.lat], c.body[tgtSp.lon],
        );
        const dtSec = Math.abs(Number(obs.body[obsSp.time] - c.body[tgtSp.time])) / 1e9;
        if (km <= rule.max_km && dtSec <= rule.max_dt_s) {
          const s = rule.base_score * (1 - km / rule.max_km) * (1 - dtSec / rule.max_dt_s);
          score = Math.max(score, s);
          reasons.push(`${km.toFixed(2)} km / ${(dtSec / 60).toFixed(1)} min apart`);
        }
      }
    }
    if (score > 0) scored.push({ entity: c, score, reasons });
  }
  scored.sort((a, b) => b.score - a.score);

  const top = scored[0] || null;
  const th = cfg.thresholds;
  let action;
  if (!top || top.score < th.review) action = 'new';
  else if (top.score >= th.merge) action = 'merge';
  else if (top.score >= th.link) action = 'link';
  else action = 'review';
  return { obs, candidates: scored, top, action };
}
