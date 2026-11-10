// F4 value help of classic screens (selection screens, dynpros), like SAP's: a screen field's dictionary reference
// decides where the values come from, in SAP's order:
//   1. the check table of the table field (CDS "with foreign key <table> where ..."), rows of that table;
//   2. the fixed values of the field's domain, with their texts;
//   3. the value table of the domain, rows of that table.
// The field is found from its name on the screen (P_X, S_X-LOW, ZPO_HEAD-LIFNR, GS_HEAD-STATUS, GV_X) and the
// declarations of the app's programs (PARAMETERS / SELECT-OPTIONS FOR / TABLES / DATA).
import fs from 'node:fs';
import path from 'node:path';
import { listSources } from '../rap/model.js';
import { parseCds } from '../ddl/cds.js';
import { readDdic } from '../rap/ddic.js';

const ADMIN = /^(client|mandt|created_by|created_at|last_changed_by|last_changed_at|local_last_changed_at|crea_.*|lchg_.*)$/i;
const MAX = 200;

let cache = { at: 0, dir: null, cat: null };
// the app's dictionary and program declarations (rebuilt at most every 2 s: programs change while the engine runs)
export function catalog(appDir) {
  if (cache.dir === appDir && Date.now() - cache.at < 2000) return cache.cat;
  const files = listSources(appDir);
  const tables = new Map();
  for (const f of files) {
    if (!/\.tabl\.cds$/i.test(f)) continue;
    try { for (const d of parseCds(fs.readFileSync(f, 'utf8'), path.basename(f))) if (d.kind === 'table' || d.kind === 'structure') tables.set(d.name, d); } catch { /* reported by the activation */ }
  }
  const sources = files.filter(f => /\.(prog|fugr)\.[^/]*abap$/i.test(path.basename(f)))
    .map(f => ({ program: path.basename(f).split('.')[0].toUpperCase(), text: stripComments(fs.readFileSync(f, 'utf8')) }));
  const cat = { tables, ddic: readDdic(files), sources };
  cache = { at: Date.now(), dir: appDir, cat };
  return cat;
}

const stripComments = s => s.split('\n').filter(l => !/^\*/.test(l)).map(l => l.replace(/"[^']*$/, '')).join('\n');
const esc = s => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

// the declaration of a name: { kind: 'type', type } (PARAMETERS ... TYPE / LIKE, DATA ... TYPE), { kind: 'for', ref }
// (SELECT-OPTIONS ... FOR), { kind: 'tables' } (TABLES); the program named by the page first
function declaration(cat, name, program) {
  const ordered = [...cat.sources].sort((a, b) => (b.program === program) - (a.program === program));
  const n = esc(name);
  // statements may be chained (PARAMETERS: a TYPE x, b TYPE y.)
  const pats = [
    [new RegExp(`(?:^|[:,.]\\s*|\\bPARAMETERS:?\\s+)${n}\\b[^.,]*?\\b(?:TYPE|LIKE)\\s+([\\w/-]+)`, 'im'), 'type', /\bPARAMETERS\b/i],
    [new RegExp(`(?:^|[:,]\\s*|\\bSELECT-OPTIONS:?\\s+)${n}\\s+FOR\\s+([\\w/-]+)`, 'im'), 'for', /\bSELECT-OPTIONS\b/i],
    [new RegExp(`\\bTABLES:?\\s+(?:[\\w/]+\\s*,\\s*)*${n}\\b`, 'im'), 'tables', null],
    [new RegExp(`(?:^|[:,]\\s*|\\bDATA:?\\s+)${n}\\s+(?:TYPE|LIKE)\\s+(?!REF\\b|STANDARD\\b|SORTED\\b|HASHED\\b|TABLE\\b|RANGE\\b)([\\w/-]+)`, 'im'), 'type', /\b(DATA|PARAMETERS)\b/i],
  ];
  for (const s of ordered) {
    for (const [re, kind, stmt] of pats) {
      const m = re.exec(s.text);
      if (!m) continue;
      // the match must sit in a statement of that kind (the text from the last period before it)
      if (stmt) { const before = s.text.slice(0, m.index + m[0].length); const st = before.slice(before.lastIndexOf('.') + 1); if (!stmt.test(st)) continue; }
      return kind === 'tables' ? { kind } : { kind, ref: m[1].toLowerCase() };
    }
  }
  return null;
}

// a dictionary reference "table-field" / "struct-field" / data element -> { table, field, def, de }
function fieldOf(cat, table, field) {
  const def = cat.tables.get(table);
  const f = def?.fields.find(x => x.name === field);
  if (!f) return { table, field, de: null };
  const t = String(f.type?.name ?? f.type ?? '').toLowerCase();
  return { table, field, def: f, de: t && !t.startsWith('abap.') ? t : null };
}
function refOf(cat, ref, program, depth = 0) {
  if (depth > 3 || !ref) return null;
  const [head, ...rest] = ref.split('-');
  if (rest.length) {
    if (cat.tables.has(head)) return fieldOf(cat, head, rest.join('-'));
    // a variable typed by a table or structure: gs_head-status
    const d = declaration(cat, head.toUpperCase(), program);
    if (d?.kind === 'tables') return fieldOf(cat, head, rest.join('-'));
    if (d?.ref && cat.tables.has(d.ref)) return fieldOf(cat, d.ref, rest.join('-'));
    if (head === 'sy' || head === 'syst') return null;
    return null;
  }
  if (cat.ddic.dataElements.has(ref) || cat.ddic.domains.has(ref)) return { de: ref };
  // a variable: its declaration
  const d = declaration(cat, ref.toUpperCase(), program);
  return d?.ref ? refOf(cat, d.ref, program, depth + 1) : null;
}

// the field on the screen -> its dictionary reference, or null
export function resolveField(cat, screenName, program = '') {
  const name = String(screenName || '').toUpperCase().replace(/^GG_EDITOR_/, '').replace(/-\d+-(LOW|HIGH)$/, '-$1');
  const parts = name.split('-');
  // select-option S_X-LOW / S_X-HIGH, parameter P_X, variable GV_X
  const own = declaration(cat, parts[0], program);
  if (own?.kind === 'for' && (parts.length === 1 || /^(LOW|HIGH)$/.test(parts[1]))) return refOf(cat, own.ref, program);
  if (parts.length === 1) return own?.ref ? refOf(cat, own.ref, program) : null;
  return refOf(cat, name.toLowerCase(), program);
}

// where the values come from, or null when the field has no value help
export function helpOf(cat, ref) {
  if (!ref) return null;
  if (ref.def?.checkTable) {
    const own = ref.field;
    const key = ref.def.fkPairs?.find(([, o]) => o === own)?.[0] || own;
    return { kind: 'check', table: ref.def.checkTable, key };
  }
  const de = ref.de && cat.ddic.dataElements.get(ref.de);
  const dom = cat.ddic.domains.get(de?.domain || ref.de || '');
  if (dom?.fixed?.length) return { kind: 'fixed', values: dom.fixed, domain: dom.name };
  if (dom?.valueTable) return { kind: 'check', table: dom.valueTable, key: null };
  return null;
}

// the label of a field: its data element's medium label, else its name
function labelOf(cat, table, column) {
  const f = cat.tables.get(table)?.fields.find(x => x.name === column);
  const de = f && cat.ddic.dataElements.get(String(f.type?.name ?? f.type ?? '').toLowerCase());
  return de?.labels?.medium || de?.labels?.short || de?.text || f?.ann?.endusertext?.label || column.toUpperCase();
}

// the hit list: { title, columns: [{ name, label }], rows: [[...]], key: <column index of the value>, more }
// sqlAll(query, ...args) -> rows (the engine's database; tables of other apps are attached there)
export function hitList(cat, ref, help, sqlAll, search = '') {
  const q = String(search || '').trim().replace(/\*/g, '%');
  const de = ref.de && cat.ddic.dataElements.get(ref.de);
  const title = de?.labels?.medium || de?.text || ref.def?.ann?.endusertext?.label || (ref.de || ref.field || '').toUpperCase();
  if (help.kind === 'fixed') {
    const like = s => !q || new RegExp(q.split('%').map(esc).join('.*'), 'i').test(s);
    const rows = help.values.filter(v => like(v.low) || like(v.text)).map(v => [v.low, v.text]);
    return { title, columns: [{ name: 'value', label: 'Value' }, { name: 'text', label: 'Short description' }], rows, key: 0, more: false };
  }
  const table = help.table.replace(/"/g, '');
  const info = sqlAll(`PRAGMA table_info("${table}")`);
  if (!info.length) return { title, columns: [], rows: [], key: 0, more: false, missing: table.toUpperCase() };
  const cols = info.map(c => c.name);
  const keyCols = info.filter(c => c.pk).sort((a, b) => a.pk - b.pk).map(c => c.name).filter(c => !ADMIN.test(c));
  const key = help.key && cols.includes(help.key) ? help.key : keyCols[keyCols.length - 1] || cols.find(c => !ADMIN.test(c));
  const textish = cols.filter(c => c !== key && !ADMIN.test(c) && /name|text|desc|bez|ort|city|land|country|title|descr|kurz/i.test(c));
  const others = cols.filter(c => c !== key && !ADMIN.test(c) && !textish.includes(c));
  const shown = [key, ...keyCols.filter(c => c !== key), ...textish, ...others].filter((c, i, a) => a.indexOf(c) === i).slice(0, 5);
  const where = q ? ` WHERE ${shown.map(c => `CAST("${c}" AS TEXT) LIKE ?`).join(' OR ')}` : '';
  const args = q ? shown.map(() => `%${q}%`) : [];
  const rows = sqlAll(`SELECT ${shown.map(c => `"${c}"`).join(', ')} FROM "${table}"${where} ORDER BY "${key}" LIMIT ${MAX + 1}`, ...args)
    .map(r => shown.map(c => r[c] ?? ''));
  return { title, table: table.toUpperCase(), columns: shown.map(c => ({ name: c, label: labelOf(cat, table, c) })), rows: rows.slice(0, MAX), key: 0, more: rows.length > MAX };
}
