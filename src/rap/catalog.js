// System catalog: all apps in a studio form one "system", like one SAP system. An app may use tables and
// CDS views that another app owns (product master, customers, ...). Activation looks names up here,
// loads the owner's definitions read-only, and reads the owner's data (see Model.createSchema).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCds } from '../ddl/cds.js';

export const SYSTEM_MARKER = '.rap-system.json';

// the folder holding all apps of the system, or null for a standalone workspace
export function systemDirOf(dir, opts = {}) {
  if (opts.systemDir === false) return null;
  const cand = opts.systemDir || process.env.RAP_SYSTEM_DIR || path.dirname(path.resolve(dir));
  return fs.existsSync(path.join(cand, SYSTEM_MARKER)) || opts.systemDir ? path.resolve(cand) : null;
}

const fileCache = new Map();   // file -> { mtime, defs }
function defsOf(file) {
  const st = fs.statSync(file);
  const c = fileCache.get(file);
  if (c && c.mtime === st.mtimeMs) return c.defs;
  let defs = [];
  try { defs = parseCds(fs.readFileSync(file, 'utf8'), path.basename(file)); } catch { /* broken sources are the owner's problem */ }
  fileCache.set(file, { mtime: st.mtimeMs, defs });
  return defs;
}

// The SAP standard layer (standard/s4hana): organisational units, configuration and master data with SAP's table
// names and the released CDS views on top (I_Product, I_Customer, ...). Every system has it, like a fresh S/4HANA
// client; it is owned by the built-in app "s4hana" (read-only for the apps, maintained by standard/generate.py).
export const STANDARD_APP = 's4hana';
export const STANDARD_DIR = path.resolve(fileURLToPath(new URL('../../standard/s4hana', import.meta.url)));

// name -> { app, appDir, file, def } for every table and view entity of the other apps, then of the standard layer
export function systemCatalog(systemDir, exceptDir, { standard = true } = {}) {
  const out = new Map();
  const except = exceptDir && path.resolve(exceptDir);
  const scan = (app, appDir) => {
    const src = path.join(appDir, 'src');
    if (appDir === except || !fs.existsSync(src)) return;
    for (const f of fs.readdirSync(src).sort()) {
      if (!/\.(tabl\.cds|ddls\.asddls|cds)$/i.test(f)) continue;
      const file = path.join(src, f);
      for (const def of defsOf(file)) {
        if (!['table', 'view'].includes(def.kind) || out.has(def.name)) continue;
        if ((def.fields || []).some(f => f.include || f.name === '%admin')) continue;   // draft tables belong to their BO
        out.set(def.name, { app, appDir, file, rel: `${app}/src/${f}`, def, standard: appDir === STANDARD_DIR });
      }
    }
  };
  if (systemDir) {
    for (const e of fs.readdirSync(systemDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (e.isDirectory() && !e.name.startsWith('.') && e.name !== STANDARD_APP) scan(e.name, path.join(systemDir, e.name));
    }
  }
  if (standard) scan(STANDARD_APP, STANDARD_DIR);
  return out;
}

// names a definition refers to: sources, joins, association targets, value helps, exposed entities
export function referencesOf(def) {
  const out = new Set();
  if (def.from?.name) out.add(def.from.name);
  for (const j of def.joins || []) if (j.name) out.add(j.name);
  for (const a of def.assocs || []) if (a.target) out.add(a.target);
  for (const x of def.exposes || []) if (x.entity) out.add(x.entity);
  const walk = o => {
    if (!o || typeof o !== 'object') return;
    if (Array.isArray(o)) { o.forEach(walk); return; }
    for (const [k, v] of Object.entries(o)) {
      if (k === 'valuehelpdefinition') for (const d of [].concat(v)) { const n = d?.entity?.name; if (n) out.add(String(n).toLowerCase()); }
      else if (k !== 'from' && k !== 'joins') walk(v);
    }
  };
  walk(def.ann); walk(def.elements);
  return out;
}

// a readable list of what exists, for the agent (rap catalog) and the new-app prompt
export function describeCatalog(cat, search) {
  const q = search ? String(search).toLowerCase() : null;
  const rows = [];
  for (const [name, x] of cat) {
    const d = x.def;
    const cols = (d.fields || d.elements || []).filter(f => !/clnt/i.test(String(f.type?.name ?? f.type ?? '')) && !/^(client|mandt)$/i.test(f.name || ''));
    const fields = cols.map(f => f.label || f.alias || f.name).filter(Boolean);
    const keys = cols.filter(f => f.key).map(f => f.label || f.name);
    const text = `${d.label} ${x.app} ${fields.join(' ')} ${d.ann?.endusertext?.label || ''}`.toLowerCase();
    if (q && !q.split(/\s+/).every(w => text.includes(w))) continue;
    const kind = d.kind === 'table' ? 'table' : d.projection ? 'projection view' : 'view';
    const dropdown = String(d.ann?.objectmodel?.resultset?.sizecategory || '').toUpperCase() === '#XS' ? ', drop-down (#XS)' : '';
    rows.push(`${d.label.padEnd(28)} ${kind}${dropdown}, app ${x.app}${d.ann?.endusertext?.label ? ` — ${d.ann.endusertext.label}` : ''}\n    key ${keys.join(', ') || '-'}; fields ${fields.slice(0, 12).join(', ')}${fields.length > 12 ? ', …' : ''}`);
  }
  return rows;
}
