// registry.mjs — load the git-vault registry (registry/*.json) into the
// in-memory runtime model. In production this compiled model is what every
// service and the broker hold; the data path never touches the JSON files.
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const REG_DIR = join(HERE, '..', 'registry');

// global field-id = (namespace id << 16) | local id  — append-only, never reused.
export const gid = (nsId, localId) => ((nsId << 16) | localId) >>> 0;

export function loadRegistry() {
  const files = readdirSync(REG_DIR).filter((f) => f.endsWith('.json'));
  const read = (f) => JSON.parse(readFileSync(join(REG_DIR, f), 'utf8'));

  // namespaces
  const nsDoc = read('namespaces.json');
  const nsById = new Map();
  const nsByName = new Map();
  for (const ns of nsDoc.namespaces) { nsByName.set(ns.name, ns); nsById.set(ns.id, ns); }

  // canonical types
  const types = new Map();
  for (const f of files) {
    const d = read(f);
    if (!d.type || !d.fields) continue;
    const ns = nsByName.get(d.namespace);
    if (!ns) throw new Error(`type ${d.type}: unknown namespace ${d.namespace}`);
    const fields = d.fields.map((fl) => ({
      ...fl, key: fl.name, ns: ns.name, gid: gid(ns.id, fl.local_id), core: true,
    }));
    types.set(d.type, {
      name: d.type, version: d.version, namespace: ns.name,
      identity: d.identity, spatial: d.spatial, resolution: d.resolution, fields,
    });
  }

  // field extensions (namespaced fields bolted onto an existing type)
  for (const f of files) {
    const d = read(f);
    if (!d.field_extensions) continue;
    const ns = nsByName.get(d.namespace);
    if (!ns) throw new Error(`extension: unknown namespace ${d.namespace}`);
    for (const [typeName, extFields] of Object.entries(d.field_extensions)) {
      const t = types.get(typeName);
      if (!t) throw new Error(`extension targets unknown type ${typeName}`);
      for (const fl of extFields) {
        t.fields.push({
          ...fl, key: `${ns.name}:${fl.name}`, ns: ns.name,
          gid: gid(ns.id, fl.local_id), core: false,
        });
      }
    }
  }

  // index: type -> (gid -> field), for binary decode. Field-ids are
  // TYPE-SCOPED: the zmesg envelope already names the type, so a local_id need
  // only be unique within its type — not across the whole namespace.
  const byGidInType = new Map();
  for (const t of types.values()) {
    const m = new Map();
    for (const fl of t.fields) m.set(fl.gid, fl);
    byGidInType.set(t.name, m);
  }

  return {
    nsByName, nsById, types,
    type: (name) => {
      const t = types.get(name);
      if (!t) throw new Error(`unknown type ${name}`);
      return t;
    },
    fieldByGid: (typeName, g) => byGidInType.get(typeName)?.get(g),
  };
}
