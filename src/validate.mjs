// validate.mjs — minimal, zero-dep validator implementing the subset of JSON
// Schema the codegen emits. Stands in for AJV in production. Its job here is to
// prove the governance rule: core fields strict, namespaced fields pass through,
// un-namespaced unknowns rejected.
const NS_KEY = /^[a-z][a-z0-9_]*:[a-z][a-z0-9_]*$/;

const jtype = (v) => {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (typeof v === 'number') return Number.isInteger(v) ? 'integer' : 'number';
  return typeof v; // string | boolean | object
};

const typeOk = (v, allowed) => {
  const a = Array.isArray(allowed) ? allowed : [allowed];
  const t = jtype(v);
  return a.includes(t) || (t === 'integer' && a.includes('number'));
};

// returns { ok, errors[] }
export function validate(body, schema) {
  const errors = [];
  for (const r of schema.required) {
    if (body[r] === undefined) errors.push(`missing required field: ${r}`);
  }
  for (const [k, v] of Object.entries(body)) {
    const p = schema.properties[k];
    if (p) {
      if (!typeOk(v, p.type)) errors.push(`field ${k}: expected ${p.type}, got ${jtype(v)}`);
      if (p.enum && !p.enum.includes(v)) errors.push(`field ${k}: ${JSON.stringify(v)} not in enum`);
    } else if (NS_KEY.test(k)) {
      // namespaced extension field — owned elsewhere, passes core validation
      continue;
    } else {
      errors.push(`field ${k}: unknown un-namespaced field (rejected by additionalProperties:false)`);
    }
  }
  return { ok: errors.length === 0, errors };
}
