// Function module test (SAP's SE37 "Test/Execute"): calls a function module of the app with typed parameters
// built from its interface and the dictionary types, and returns what it exported, changed or raised.
// Used by host.mjs for the test page and the JSON API (rap fm, the studio's Run button).
import fs from 'node:fs';
import path from 'node:path';
import { parseFunction } from './fugr.mjs';

// the app's function modules with their interface, from the sources the engine was built from
export function listFunctions(work) {
  const dir = path.join(work, 'app');
  const out = [];
  for (const f of fs.existsSync(dir) ? fs.readdirSync(dir).sort() : []) {
    const m = /^([\w$#]+)\.fugr\.([\w$#]+)\.abap$/i.exec(f);
    if (!m) continue;
    const fn = parseFunction(fs.readFileSync(path.join(dir, f), 'utf8'));
    if (fn) out.push({ ...fn, group: m[1].toUpperCase(), file: f });
  }
  return out;
}

// a value of an interface type: dictionary types (data elements, structures, table types) or built-in types
function make(abap, p) {
  const t = (p.typ || '').toUpperCase();
  const d = abap.DDIC?.[t];
  if (d?.type) return (typeof d.type === 'function' ? d.type() : d.type).clone();
  const T = abap.types;
  switch (t) {
    case 'I': case 'INT4': return new T.Integer();
    case 'INT8': return new T.Integer8();
    case 'F': return new T.Float();
    case 'D': case 'DATS': return new T.Date();
    case 'T': case 'TIMS': return new T.Time();
    case 'P': return new T.Packed({ length: 8, decimals: 2 });
    case 'C': case 'ABAP_BOOL': case 'BOOLEAN': case 'FLAG': return new T.Character(1);
    case 'N': return new T.Numc({ length: 1 });
    case 'XSTRING': return new T.XString();
    case 'STRING_TABLE': return abap.types.TableFactory.construct(new T.String(), { withHeader: false, keyType: 'DEFAULT', primaryKey: { isUnique: false, type: 'STANDARD', keyFields: [], name: 'primary_key' }, secondary: [] });
    default: return new T.String();
  }
}
// a TABLES parameter (IT_ITEMS STRUCTURE zpo_item, LIKE zpo_item, TYPE zpo_item): a standard table with a header
// line of that line type; a TABLES parameter typed with a table type is that table
function tableOf(abap, row) {
  return abap.types.TableFactory.construct(row, { withHeader: true, keyType: 'DEFAULT', primaryKey: { isUnique: false, type: 'STANDARD', keyFields: [], name: 'primary_key' }, secondary: [] });
}
function value(abap, p, section) {
  const v = make(abap, p);
  return section === 'TABLES' && !isTable(v) ? tableOf(abap, v) : v;
}
// the shape of a parameter for the test form: 'table' (JSON array of rows), 'struct' (JSON object) or 'value', with
// the components of the structure or of the table's line
export function shapeOf(abap, p, section) {
  try {
    const v = value(abap, p, section);
    const line = isTable(v) ? v.getRowType() : v;
    const comps = isStruct(line) ? Object.keys(line.get()).map(k => k.toUpperCase()) : [];
    // date and time components / parameters: the form shows the expected format
    const kinds = {};
    if (isStruct(line)) for (const [k, x] of Object.entries(line.get())) { const t = timeKind(x); if (t) kinds[k.toUpperCase()] = t; }
    return { form: isTable(v) ? 'table' : isStruct(v) ? 'struct' : 'value', comps, kinds, kind: timeKind(v) };
  } catch { return { form: section === 'TABLES' ? 'table' : 'value', comps: [] }; }
}
const isTable = v => typeof v?.array === 'function' && typeof v?.getRowType === 'function';
const isStruct = v => v?.constructor?.name === 'Structure';
const timeKind = v => ({ Date: 'D', Time: 'T' })[v?.constructor?.name] || '';
import { userDate } from './userdate.mjs';
export const DATE_HINT = { get D() { return userDate.pattern; }, T: 'HH:MM:SS' };
// a date typed on the test form (the user's date format, or the internal YYYYMMDD) as YYYYMMDD; null when it is
// neither or no calendar day
export function parseDate(text) { return userDate.parse(text); }
// a time typed on the test form (HH:MM:SS or HHMMSS) as HHMMSS; null when it is neither or no time of day
export function parseTime(text) {
  const m = /^(\d{2}):(\d{2}):(\d{2})$/.exec(String(text).trim()) || /^(\d{2})(\d{2})(\d{2})$/.exec(String(text).trim());
  return m && Number(m[1]) < 24 && Number(m[2]) < 60 && Number(m[3]) < 60 ? `${m[1]}${m[2]}${m[3]}` : null;
}
// JSON (from the test form) into an ABAP value; a date or time that is not one is a field error (never truncated)
function fill(abap, target, value, where = '', errors = []) {
  if (value === undefined || value === null || value === '') return target;
  if (typeof value === 'string' && (isTable(target) || isStruct(target))) { try { value = JSON.parse(value); } catch { errors.push({ field: where, message: `${where}: not valid JSON` }); return target; } }
  if (isTable(target)) {
    (Array.isArray(value) ? value : [value]).forEach((row, i) => {
      const line = target.getRowType().clone();
      fill(abap, line, row, `${where}[${i + 1}]`, errors);
      target.append(line);
    });
  } else if (isStruct(target)) {
    const fields = target.get();
    for (const [k, v] of Object.entries(value || {})) { const f = fields[k.toLowerCase()]; if (f) fill(abap, f, v, `${where}-${k.toUpperCase()}`, errors); }
  } else if (timeKind(target)) {
    const kind = timeKind(target);
    const v = (kind === 'D' ? parseDate : parseTime)(value);
    if (v === null) errors.push({ field: where, message: `${where}: "${value}" is not a valid ${kind === 'D' ? 'date' : 'time'} (${DATE_HINT[kind]}${kind === 'D' ? ' or YYYYMMDD' : ''})` });
    else target.set(v);
  } else target.set(typeof value === 'object' ? JSON.stringify(value) : value);
  return target;
}
// an ABAP value as JSON
export function toJs(v) {
  if (isTable(v)) return v.array().map(toJs);
  if (isStruct(v)) return Object.fromEntries(Object.entries(v.get()).map(([k, x]) => [k.toUpperCase(), toJs(x)]));
  const g = v?.constructor?.name === 'Float' ? v.getRaw() : v?.get?.();
  return typeof g === 'string' ? g.trimEnd() : typeof g === 'bigint' ? Number(g) : g;
}

// calls one function module; params: { PARAMETER: value } (strings, objects for structures, arrays for tables)
export async function runFunction(abap, work, name, params = {}) {
  const fn = listFunctions(work).find(f => f.name === String(name).toUpperCase());
  if (!fn) throw Object.assign(new Error(`Function module ${String(name).toUpperCase()} does not exist`), { status: 404 });
  const impl = abap.FunctionModules?.[fn.name];
  if (!impl) throw Object.assign(new Error(`Function module ${fn.name} is not active: see Problems`), { status: 400 });
  const input = Object.fromEntries(Object.entries(params).map(([k, v]) => [k.toUpperCase(), v]));
  const call = { exporting: {}, importing: {}, changing: {}, tables: {} };
  const values = {};
  const errors = [];
  const sec = { IMPORTING: 'exporting', EXPORTING: 'importing', CHANGING: 'changing', TABLES: 'tables' };
  for (const [s, key] of Object.entries(sec)) {
    for (const p of fn.sections[s] || []) {
      const v = value(abap, p, s);
      if (s !== 'EXPORTING') fill(abap, v, input[p.parameter] ?? (p.default && !/^'|^\d/.test(p.default) ? undefined : p.default?.replace(/^'(.*)'$/, '$1')), p.parameter, errors);
      if (s === 'IMPORTING' && input[p.parameter] === undefined && p.optional && !p.default) continue;
      values[p.parameter] = v;
      call[key][p.parameter.toLowerCase()] = v;
    }
  }
  // wrong input stops before the call: the form marks the fields
  if (errors.length) throw Object.assign(new Error(errors.map(e => e.message).join('\n')), { status: 400, fields: errors });
  const sy = abap.builtin.sy.get();
  const t0 = Date.now();
  let exception = null, error = null;
  sy.subrc.set(0);
  try { await impl(call); }
  catch (e) {
    // classic exceptions (RAISE / MESSAGE ... RAISING) end the call with sy-subrc; class-based ones are errors
    if (e?.classic) {
      exception = String(e.classic).toUpperCase();
      const i = (fn.sections.EXCEPTIONS || []).findIndex(x => x.parameter === exception);
      sy.subrc.set(i >= 0 ? i + 1 : (fn.sections.EXCEPTIONS || []).length + 1);
    } else {
      const cls = e?.constructor?.name && e.constructor.name !== 'Error' ? e.constructor.name.toUpperCase() : '';
      let text = e?.message || '';
      try { text = text || (await e.get_text?.())?.get?.() || ''; } catch {}
      error = `${cls ? `${cls}: ` : ''}${text || String(e)}`;
    }
  }
  const out = s => Object.fromEntries((fn.sections[s] || []).map(p => [p.parameter, toJs(values[p.parameter])]).filter(([, v]) => v !== undefined));
  return { function: fn.name, group: fn.group, subrc: Number(sy.subrc.get()), exception, error, ms: Date.now() - t0,
    exporting: out('EXPORTING'), changing: out('CHANGING'), tables: out('TABLES') };
}
