// codegen.mjs — one registry type -> four artifacts:
//   JSON Schema (AJV validation)   |  zmesg field dictionary (binary)
//   TypeScript interface           |  SQLite DDL (read projection)
// All four are projections of the single registry entry; none defines the model.
const jsonSchemaType = (f) => (f.nullable ? [f.type, 'null'] : f.type);

export function genJsonSchema(t) {
  const properties = {};
  const required = [];
  for (const f of t.fields) {
    if (!f.core) continue; // namespaced fields validated by their own ns schema
    const p = { type: jsonSchemaType(f) };
    if (f.enum) p.enum = f.nullable ? [...f.enum, null] : f.enum;
    if (f.doc) p.description = f.doc;
    properties[f.name] = p;
    if (f.required) required.push(f.name);
  }
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: `${t.name}@${t.version}`,
    type: 'object',
    required,
    properties,
    // governance rule, encoded: namespaced keys are allowed (their own ns
    // schema validates them); un-namespaced unknown keys are rejected.
    patternProperties: { '^[a-z][a-z0-9_]*:[a-z][a-z0-9_]*$': {} },
    additionalProperties: false,
  };
}

export function genFieldDict(t) {
  return {
    type: t.name,
    version: t.version,
    fields: t.fields.map((f) => ({ key: f.key, gid: f.gid, repr: f.repr, core: f.core })),
  };
}

export function genTypeScript(t) {
  const tsType = (f) => {
    let b = { integer: 'number', number: 'number', string: 'string', boolean: 'boolean', array: 'unknown[]', object: 'Record<string, unknown>' }[f.type];
    if (f.enum) b = f.enum.map((e) => JSON.stringify(e)).join(' | ');
    return f.nullable ? `${b} | null` : b;
  };
  const lines = [`// generated from ${t.name}@${t.version} — do not edit`];
  lines.push(`export interface ${t.name.replace(':', '_')} {`);
  for (const f of t.fields) {
    const opt = f.required ? '' : '?';
    lines.push(`  ${JSON.stringify(f.key)}${opt}: ${tsType(f)};`);
  }
  lines.push('}');
  return lines.join('\n') + '\n';
}

export function genSqlDdl(t) {
  const table = t.name.replace(':', '_').toLowerCase();
  const cols = ['  id TEXT PRIMARY KEY'];
  for (const f of t.fields) {
    if (!f.core) continue; // namespaced fields land in a side table or JSON column
    cols.push(`  ${f.name} ${f.sql}${f.required ? ' NOT NULL' : ''}`);
  }
  cols.push('  _ext TEXT', '  _provenance TEXT');
  const idField = t.identity?.fields?.[0];
  let ddl = `CREATE TABLE ${table} (\n${cols.join(',\n')}\n);\n`;
  if (idField) ddl += `CREATE INDEX idx_${table}_${idField} ON ${table}(${idField});\n`;
  return ddl;
}
