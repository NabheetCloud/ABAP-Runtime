// Creating objects by hand, like ADT's "New" wizards: every object kind the runtime supports, as a working skeleton
// in the abapGit layout (src/…), and the RAP business object generator (a table -> root view, projection, metadata
// extension, behavior definitions with draft, behavior pool, service definition, Fiori elements app).
// objectFiles( kind, options, context ) and rapBoFiles( workspace, options ) only compute the files; the server
// writes them (POST /api/generate/object, /api/generate/rapbo) and activates.
import fs from 'node:fs';
import path from 'node:path';
import { DDIC_TYPES, ddicType, readDdic, builtinOf } from '../rap/ddic.js';
import { listSources } from '../rap/model.js';
import { parseCds } from '../ddl/cds.js';
import { paramsFromLines, interfaceBlock, checkFm } from '../ui/studio/visual/fm.js';
import { selectionNames } from '../ui/studio/visual/classic.js';
import { parseParams, resolveParams, loadInterface, signature } from '../forms/interface.js';
import { generateXdpFromInterface } from '../forms/xfa/generate.js';

// ---------------------------------------------------------------- names
const NAME = /^[ZY][A-Z0-9_]*$/i;
export function checkName(name, { max = 30, prefix = '' } = {}) {
  const n = String(name || '').trim();
  if (!n) return 'Enter a name';
  if (!NAME.test(n)) return 'The name must start with Z or Y and contain only letters, digits and _ (customer namespace)';
  if (prefix && !n.toUpperCase().startsWith(prefix)) return `The name should start with ${prefix}`;
  if (n.length > max) return `At most ${max} characters`;
  return null;
}
const lc = s => String(s).toLowerCase();
const uc = s => String(s).toUpperCase();
const xml = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// column name -> CDS element name: travel_uuid -> TravelUUID, customer_id -> CustomerID
export function camel(col) {
  return String(col).split('_').filter(Boolean).map(p => (/^(id|uuid|url|vat|iban)$/i.test(p) ? p.toUpperCase() : p[0].toUpperCase() + p.slice(1).toLowerCase())).join('') || col;
}
const words = s => camel(s).replace(/([a-z])([A-Z])/g, '$1 $2').replace(/UUID$/, 'UUID').trim();

// a .tabl.cds: its fields with the types as written
export function parseTable(text) {
  const body = /\{([\s\S]*)\}/.exec(text)?.[1] || '';
  const fields = [];
  for (const raw of body.split(';')) {
    const line = raw.replace(/\/\/.*$/gm, '').replace(/@[^\n]*\n/g, '').trim();
    const m = /^(key\s+)?("?[%\w]+"?)\s*:\s*(include\s+)?([^]+?)\s*$/i.exec(line);
    if (!m) continue;
    const ty = m[4].replace(/\s+with\s+foreign\s+key[\s\S]*$/i, '').trim();
    fields.push({ name: m[2].replace(/"/g, ''), key: !!m[1], type: ty.replace(/\s+not\s+null$/i, '').trim(), include: !!m[3], notNull: /not\s+null$/i.test(ty) });
  }
  const def = /define\s+(table|structure)\s+(\w+)/i.exec(text);
  return { name: def?.[2], kind: def ? def[1].toLowerCase() : 'table', label: /@EndUserText\.label\s*:\s*'([^']*)'/.exec(text)?.[1] || '', fields };
}

// ---------------------------------------------------------------- the kinds (the dialog's list and fields)
// field types beyond text / textarea / select / number / checkbox: table, view, source, service, bdef, views (from the
// app), domain / dtel / type / program / sfpi / fugr (inputs with the app's objects as suggestions)
const F = (k, label, type = 'text', extra = {}) => ({ k, label, type, ...extra });
const DESC = F('description', 'Description');
export const DDIC_TYPE_OPTIONS = Object.entries(DDIC_TYPES).map(([k, v]) => [k, `${k} · ${v.text}`]);
const FIELDS_HELP = 'name type, one per line. Types: abap.char(10), char(10), numc(5), curr(15,2), cuky, dats … or a data element / structure. "ref waers" after an amount or quantity names its currency / unit field; "include zstruct" adds an include structure.';
export const KINDS = [
  // Dictionary
  { id: 'table', group: 'Dictionary', label: 'Database table', icon: 'TABL', prefix: 'Z', max: 16, fields: [DESC, F('uuidKey', 'UUID key (managed numbering in RAP)', 'checkbox', { default: true, rap: true }), F('keys', 'Key fields (name type, one per line)', 'textarea', { placeholder: 'ebeln zpo_ebeln' }), F('fields', 'Fields', 'textarea', { placeholder: 'lifnr abap.char(10)\nnetwr abap.curr(15,2) ref waers\nwaers abap.cuky\ninclude zpo_s_admin', help: FIELDS_HELP }), F('admin', 'Administrative fields (created / changed by and at)', 'checkbox', { default: true, rap: true }),
    F('deliveryClass', 'Delivery class', 'select', { options: [['A', 'A · Application table (master and transaction data)'], ['C', 'C · Customizing table'], ['L', 'L · Temporary data'], ['G', 'G · Customizing, protected'], ['E', 'E · Control table'], ['S', 'S · System table']], default: 'A', advanced: true }),
    F('dataClass', 'Data class (technical settings)', 'select', { options: [['APPL0', 'APPL0 · Master data'], ['APPL1', 'APPL1 · Transaction data'], ['APPL2', 'APPL2 · Organization and customizing'], ['USER', 'USER · Customer data class']], default: 'APPL0', advanced: true }),
    F('sizeCategory', 'Size category', 'select', { options: [['0', '0 · up to ~ 10 000 rows'], ['1', '1 · up to ~ 50 000'], ['2', '2 · up to ~ 200 000'], ['3', '3 · up to ~ 800 000'], ['4', '4 · more']], default: '0', advanced: true }),
    F('buffering', 'Buffering', 'select', { options: [['NOT_ALLOWED', 'Not allowed'], ['ALLOWED_BUT_OFF', 'Allowed but switched off'], ['ON', 'Switched on (single records)']], default: 'NOT_ALLOWED', advanced: true })] },
  { id: 'stru', group: 'Dictionary', label: 'Structure', icon: 'TABL', prefix: 'Z', fields: [DESC, F('fields', 'Components', 'textarea', { placeholder: 'ebeln zpo_ebeln\nnetwr zpo_netwr ref waers\nwaers abap.cuky\ninclude zpo_s_admin', help: FIELDS_HELP })] },
  { id: 'dtel', group: 'Dictionary', label: 'Data element', icon: 'DTEL', fields: [DESC, F('domain', 'Domain (empty: a built-in type)', 'domain', { placeholder: 'ZPO_STATUS' }), F('datatype', 'Data type (without a domain)', 'select', { options: DDIC_TYPE_OPTIONS, default: 'CHAR' }), F('length', 'Length', 'number', { default: 10 }), F('decimals', 'Decimals', 'number', { default: 0 }),
    F('short', 'Short label (10)', 'text', { maxlength: 10, fromDescription: 10 }), F('medium', 'Medium label (20)', 'text', { maxlength: 20, fromDescription: 20 }), F('long', 'Long label (40)', 'text', { maxlength: 40, fromDescription: 40 }), F('heading', 'Heading (55)', 'text', { maxlength: 55, fromDescription: 55 })] },
  { id: 'doma', group: 'Dictionary', label: 'Domain', icon: 'DOMA', fields: [DESC, F('datatype', 'Data type', 'select', { options: DDIC_TYPE_OPTIONS, default: 'CHAR' }), F('length', 'Length (no. of characters / digits)', 'number', { default: 1 }), F('decimals', 'Decimals', 'number', { default: 0 }),
    F('sign', 'Sign (negative values allowed)', 'checkbox'), F('lowercase', 'Lower case letters allowed', 'checkbox'), F('values', 'Fixed values (value text, one per line)', 'textarea', { placeholder: 'N New\nR Released\nC Closed' }), F('valueTable', 'Value table (optional)', 'table')] },
  { id: 'ttyp', group: 'Dictionary', label: 'Table type', icon: 'TTYP', fields: [DESC, F('rowtype', 'Line type (structure, table or data element)', 'type', { placeholder: 'ZPO_S_ITEM' }), F('access', 'Access', 'select', { options: [['T', 'Standard table'], ['S', 'Sorted table'], ['H', 'Hashed table']], default: 'T' }), F('keydef', 'Primary key', 'select', { options: [['D', 'Standard key'], ['T', 'Table line'], ['N', 'Not specified (empty)']], default: 'D' })] },
  { id: 'enqu', group: 'Dictionary', label: 'Lock object', icon: 'ENQU', prefix: 'EZ', fields: [DESC, F('table', 'Table', 'table'), F('mode', 'Lock mode', 'select', { options: [['E', 'E · Write lock (exclusive, cumulative)'], ['S', 'S · Read lock (shared)'], ['X', 'X · Exclusive, not cumulative'], ['O', 'O · Optimistic']], default: 'E' }), F('args', 'Lock parameters (key fields, comma separated; empty: all keys)', 'text', { placeholder: 'ebeln' })] },
  // Core Data Services
  { id: 'view', group: 'Core Data Services', label: 'View entity', icon: 'DDLS', fields: [DESC, F('source', 'Data source (table or view)', 'source'), F('viewKind', 'Kind', 'select', { options: ['root', 'basic', 'child'], default: 'root' }), F('parent', 'Parent view (child entities)', 'view'), F('parentKey', 'Field that points to the parent (child entities)')] },
  { id: 'projection', group: 'Core Data Services', label: 'Projection view', icon: 'DDLS', prefix: 'ZC_', fields: [DESC, F('source', 'Projected view', 'view')] },
  { id: 'abstract', group: 'Core Data Services', label: 'Abstract entity (action parameter)', icon: 'DDLS', fields: [DESC, F('fields', 'Fields (Name type, one per line)', 'textarea', { default: 'Reason abap.char(80)' })] },
  { id: 'custom', group: 'Core Data Services', label: 'Custom entity + query class', icon: 'DDLS', fields: [DESC, F('fields', 'Fields (Name type, first is the key)', 'textarea', { default: 'Id abap.char(10)\nText abap.char(80)' }), F('className', 'Query class', 'text', { placeholder: 'ZCL_<NAME>_QUERY' })] },
  { id: 'ddlx', group: 'Core Data Services', label: 'Metadata extension', icon: 'DDLX', fields: [F('source', 'View to annotate', 'view')], nameFrom: 'source' },
  { id: 'dcls', group: 'Core Data Services', label: 'Access control', icon: 'DCLS', fields: [DESC, F('source', 'Protected view', 'view'), F('condition', 'Condition (optional)', 'text', { placeholder: "CreatedBy = aspect user" })], nameFrom: 'source' },
  // Behavior
  { id: 'bdef', group: 'Behavior', label: 'Behavior definition', icon: 'BDEF', fields: [F('source', 'Root view', 'view'), F('implType', 'Implementation', 'select', { options: ['managed', 'unmanaged', 'projection'], default: 'managed' }), F('table', 'Persistent table (managed)', 'table'), F('draft', 'With draft', 'checkbox', { default: true })], nameFrom: 'source' },
  { id: 'bpool', group: 'Behavior', label: 'Behavior pool (handler classes)', icon: 'CLAS', prefix: 'ZBP_', fields: [F('bdef', 'Behavior definition', 'bdef')] },
  // Business Services
  { id: 'srvd', group: 'Business Services', label: 'Service definition', icon: 'SRVD', prefix: 'ZUI_', fields: [DESC, F('views', 'Exposed views (comma separated)', 'views')] },
  // Source Code Library
  { id: 'class', group: 'Source Code Library', label: 'Class', icon: 'CLAS', prefix: 'ZCL_', fields: [DESC, F('classKind', 'Kind', 'select', { options: ['plain', 'console (if_oo_adt_classrun)', 'unit tests included'], default: 'console (if_oo_adt_classrun)', rapDefault: 'plain' }), F('interfaces', 'Interfaces (comma separated, optional)'),
    F('superclass', 'Superclass (optional)', 'text', { placeholder: 'e.g. zcl_po_base' }), F('methods', 'Methods', 'methods')] },
  { id: 'exception', group: 'Source Code Library', label: 'Exception class', icon: 'CLAS', prefix: 'ZCX_', fields: [DESC, F('superclass', 'Superclass', 'select', { options: ['cx_static_check', 'cx_dynamic_check', 'cx_no_check'], default: 'cx_static_check' }),
    F('msgClass', 'Message class (optional: T100 texts)', 'msag', { placeholder: 'e.g. ZPO' }), F('msgNo', 'Message number', 'text', { placeholder: '001', show: 'msgClass!=' }), F('msgAttrs', 'Attributes for &1 … &4 (comma separated)', 'text', { placeholder: 'mv_ebeln', show: 'msgClass!=' })] },
  { id: 'intf', group: 'Source Code Library', label: 'Interface', icon: 'INTF', prefix: 'ZIF_', fields: [DESC] },
  // Classic
  { id: 'report', group: 'Classic ABAP', label: 'Report (executable program)', icon: 'PROG', fields: [DESC, F('table', 'Table to list (optional)', 'table'), F('alv', 'ALV output (cl_salv_table)', 'checkbox', { default: true })] },
  { id: 'modulepool', group: 'Classic ABAP', label: 'Module pool + screen 0100 + transaction', icon: 'PROG', fields: [DESC, F('tcode', 'Transaction code', 'text', { placeholder: 'Z…' })] },
  { id: 'tran', group: 'Classic ABAP', label: 'Transaction code', icon: 'TRAN', fields: [DESC, F('program', 'Program (report or module pool)', 'program'), F('screen', 'Start screen (module pools)', 'text', { placeholder: '0100' })] },
  { id: 'fugr', group: 'Classic ABAP', label: 'Function group + function module', icon: 'FUGR', fields: [DESC, F('fm', 'Function module', 'text', { placeholder: 'Z_…' }), F('fmText', 'Short text of the function module'),
    F('params', 'Interface (one parameter per line)', 'textarea', { placeholder: 'importing iv_ebeln type zpo_ebeln\nimporting iv_max type i default 10 optional\nexporting es_header type zpo_s_header\nchanging cv_count type i\ntables it_items structure zpo_s_item optional\nexceptions not_found', help: 'importing / exporting / changing / tables / exceptions, then the name, type / like / structure / type ref to and the type; "optional", "default <value>", "value" (pass by value). Edit it later in the Design view of the function module.' })] },
  { id: 'msag', group: 'Classic ABAP', label: 'Message class', icon: 'MSAG', fields: [F('messages', 'Messages (number text, one per line)', 'textarea', { placeholder: '001 Purchase order &1 saved\n002 Purchase order &1 does not exist', help: '&1 … &4 are the message variables (MESSAGE e002(zpo) WITH lv_ebeln). Edit them later in the Design view.' })] },
  // Form objects
  { id: 'sfpi', group: 'Form Objects', label: 'Form interface (classic)', icon: 'SFPI', prefix: 'Z', fields: [DESC, F('params', 'Import parameters (name type, one per line)', 'textarea', { placeholder: 'IS_HEADER TYPE ZPO_S_HEADER\nIT_ITEMS TYPE ZPO_T_ITEM', help: 'A structure, a table type (or TYPE TABLE OF a structure) or an elementary type per parameter. The form\'s generated function module has these parameters.' }),
    F('global', 'Global data (optional, name type, one per line)', 'textarea', { placeholder: 'GV_COUNT TYPE I\nGV_TITLE TYPE STRING', help: 'Data the initialization computes; the layout binds it like a parameter ($.GV_TITLE).' }),
    F('init', 'Initialization (optional, ABAP)', 'textarea', { placeholder: 'gv_count = lines( it_items ).\ngv_title = |PO { is_header-ebeln }: { gv_count } items|.', help: 'Runs before the layout is filled, with the import parameters and the global data.' })] },
  { id: 'xdpform', group: 'Form Objects', label: 'Adobe form (XDP layout)', icon: 'XDP', prefix: 'ZF_', fields: [F('title', 'Title'), F('source', 'Data', 'select', { options: [['interface', 'Form interface (classic ABAP: driver program, FP_FUNCTION_MODULE_NAME)'], ['provider', 'Data provider (RAP: a service definition)']], default: 'interface' }),
    F('interface', 'Form interface (existing)', 'sfpi', { show: 'source=interface' }), F('params', 'or the parameters of a new interface (name type, one per line)', 'textarea', { placeholder: 'IS_HEADER TYPE ZPO_S_HEADER\nIT_ITEMS TYPE ZPO_T_ITEM', show: 'source=interface' }), F('dataProvider', 'Data provider (service definition)', 'service', { show: 'source=provider' })] },
  { id: 'jsonform', group: 'Form Objects', label: 'Print form (RAP Studio layout)', icon: 'FORM', fields: [F('title', 'Title'), F('dataProvider', 'Data provider (optional)', 'service')] },
  // Others
  { id: 'xslt', group: 'Others', label: 'Simple transformation', icon: 'XSLT', fields: [DESC] },
  { id: 'job', group: 'Others', label: 'Application job (catalog, template, class)', icon: 'SAJC', prefix: 'ZJC_', fields: [DESC] },
  { id: 'bgpf', group: 'Others', label: 'Background operation (bgPF class)', icon: 'CLAS', prefix: 'ZCL_', fields: [DESC] },
];

// ---------------------------------------------------------------- templates
const lines = t => String(t || '').split('\n').map(s => s.trim()).filter(Boolean);
const pairs = t => lines(t).map(l => { const m = /^(\S+)\s+(.+)$/.exec(l); return m ? [m[1], m[2]] : [l, '']; });
const fail = (msg, status = 400) => { throw Object.assign(new Error(msg), { status }); };
// a type as typed in the dialog: char(10) / CHAR 10 -> abap.char(10); data elements and structures in lower case
const BUILTIN = /^(char|numc|dec|curr|quan|raw|sstring|unit|cuky|dats|tims|int1|int2|int4|int8|fltp|string|rawstring|lang|clnt|utclong|datn|timn|d16n|d34n|accp|decfloat16|decfloat34)$/i;
export function ddlType(t) {
  const x = String(t || '').trim().replace(/\s*\(\s*/g, '(').replace(/\s*,\s*/g, ',').replace(/\s*\)/g, ')');
  const m = /^(?:abap\.)?([a-z0-9]+)(\(\d+(?:,\d+)?\))?$/i.exec(x);
  if (m && BUILTIN.test(m[1])) return `abap.${m[1].toLowerCase()}${m[2] || ''}`;
  return x.toLowerCase();
}
// what a component type is: 'curr' / 'quan' (needs a reference field) or null
function refKind(type, ctx) {
  if (/^abap\.curr/.test(type)) return 'amount';
  if (/^abap\.quan/.test(type)) return 'quantity';
  const b = ctx.ddic ? builtinOf(type, ctx.ddic) : null;
  return b?.name === 'abap.curr' ? 'amount' : b?.name === 'abap.quan' ? 'quantity' : null;
}
// the component lines of a table or structure: "name type [ref field] [check table]" or "include zstruct [with suffix x]"
function ddlComponents(text, { owner, ctx, key = false, defaultType = 'abap.char(40)', table = false }) {
  const out = [];
  for (const l of lines(text)) {
    const w = l.replace(/[;,]$/, '').split(/\s+/);
    if (/^include$/i.test(w[0])) {
      if (!w[1]) fail('include: name the include structure');
      out.push(`  include ${lc(w[1])}${/^with$/i.test(w[2] || '') && /^suffix$/i.test(w[3] || '') && w[4] ? ` with suffix ${lc(w[4])}` : ''};`);
      continue;
    }
    const name = lc(w[0]);
    if (!/^[a-z_][a-z0-9_]*$/.test(name)) fail(`"${w[0]}" is not a valid field name`);
    // the type may contain a blank: char (10), curr 15 2 -> curr(15,2)
    let i = 1, type = w[1] || defaultType;
    if (w[2] && /^\d+$/.test(w[2]) && BUILTIN.test(type)) { type = `${type}(${w[2]}${w[3] && /^\d+$/.test(w[3]) ? `,${w[3]}` : ''})`; i = w[3] && /^\d+$/.test(w[3]) ? 3 : 2; }
    type = ddlType(type);
    let ref = '', check = '';
    for (let j = i + 1; j < w.length; j++) {
      if (/^ref$/i.test(w[j])) ref = lc(w[++j] || '');
      else if (/^check$/i.test(w[j])) check = lc(w[++j] || '');
      else if (/^key$/i.test(w[j])) continue;
      else fail(`${name}: "${w[j]}" is not understood (after the type: ref <field>, check <table>)`);
    }
    const anns = [];
    if (ref) {
      const k = refKind(type, ctx) || (/cuky|waers|curr/i.test(ref) ? 'amount' : 'quantity');
      anns.push(`  @Semantics.${k === 'amount' ? 'amount.currencyCode' : 'quantity.unitOfMeasure'} : '${owner}.${ref}'`);
    }
    let fk = '';
    if (check && table) {
      const ct = (ctx.tables || []).find(t => lc(t.name) === check);
      const keys = ct ? ct.fields.filter(f => f.key) : [];
      const own = keys.filter(f => !/clnt/.test(f.type));
      const cond = keys.map(f => `${lc(f.name)} = ${owner}.${/clnt/.test(f.type) ? lc(f.name) : own.length === 1 ? name : lc(f.name)}`).join(' and ') || `${name} = ${owner}.${name}`;
      fk = `\n    with foreign key [0..*,1] ${check}\n      where ${cond}`;
    }
    out.push(...anns, `  ${key ? 'key ' : ''}${name.padEnd(key ? 18 : 22)}: ${type}${key && table ? ' not null' : ''}${fk};`);
  }
  return out;
}
// the methods of the class dialog: [{ name, visibility, static, params, raising, text }] (JSON from the dialog) ->
// with the signature: IMPORTING … EXPORTING … CHANGING … RETURNING VALUE(…) TYPE … RAISING …
export function classMethods(json) {
  let list = [];
  try { list = typeof json === 'string' ? (json.trim() ? JSON.parse(json) : []) : (json || []); } catch { fail('Methods: not readable'); }
  const seen = new Set();
  return list.filter(m => String(m.name || '').trim()).map(m => {
    const name = lc(String(m.name).trim());
    if (!/^[a-z_][a-z0-9_]{0,29}$/.test(name)) fail(`Method ${m.name}: not a valid name`);
    if (seen.has(name)) fail(`Method ${name} twice`);
    seen.add(name);
    // parameters: "importing iv_a type i, iv_b type string returning value(rv_x) type string" (commas optional)
    const p = String(m.params || '').replace(/,/g, ' ').replace(/\s+/g, ' ').trim();
    if (p && !/^(importing|exporting|changing|returning)\b/i.test(p)) fail(`Method ${name}: the parameters start with importing, exporting, changing or returning`);
    if (/\breturning\b/i.test(p) && !/\breturning value\(\s*\w+\s*\)/i.test(p)) fail(`Method ${name}: RETURNING needs VALUE(name)`);
    const raising = String(m.raising || '').split(/[\s,]+/).filter(Boolean).map(lc);
    const sig = `${name}${p ? ` ${p.replace(/\b(importing|exporting|changing|returning|type|ref to|value|optional|default)\b/gi, w => w.toUpperCase())}` : ''}${raising.length ? ` RAISING ${raising.join(' ')}` : ''}`;
    return { name, visibility: ['public', 'protected', 'private'].includes(m.visibility) ? m.visibility : 'public', static: !!m.static, text: String(m.text || '').trim(), signature: sig };
  });
}
// field labels from a description: whole words that fit
export function labelOf(d, max) {
  const t = String(d || '').trim();
  if (t.length <= max) return t;
  let out = '';
  for (const w of t.split(/\s+/)) { if ((out ? `${out} ${w}` : w).length > max) break; out = out ? `${out} ${w}` : w; }
  return out || t.slice(0, max);
}
const n6 = v => String(Math.max(0, Number(v) || 0)).padStart(6, '0');
// a length / decimals check of a DDIC type (dialog)
function typeSpec(datatype, length, decimals, what) {
  const dt = ddicType(datatype || 'CHAR');
  const t = DDIC_TYPES[dt];
  if (!t) fail(`${what}: unknown data type ${dt}`);
  const fixed = !Array.isArray(t.len);
  const len = fixed ? t.len : Number(length);
  if (!fixed && (!Number.isInteger(len) || len < t.len[0] || len > t.len[1])) fail(`${what}: the length of ${dt} must be ${t.len[0]}…${t.len[1]}`);
  const dec = Number(decimals) || 0;
  if (dec && !t.dec) fail(`${what}: ${dt} has no decimals`);
  if (dec && dt !== 'FLTP' && dec > len) fail(`${what}: ${dec} decimals do not fit into length ${len}`);
  // output length: digits, separators, sign and decimal point
  const out = /DEC|CURR|QUAN/.test(dt) ? len + Math.floor((len - dec - 1) / 3) + (dec ? 1 : 0) + 1 : dt === 'DATS' ? 10 : dt === 'TIMS' ? 8 : len;
  return { dt, len, dec, out };
}
const progXml = (name, subc, title, sel = [], extra = '') => `<?xml version="1.0" encoding="utf-8"?>
<abapGit version="v1.0.0" serializer="LCL_OBJECT_PROG" serializer_version="v1.0.0">
 <asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0">
  <asx:values>
   <PROGDIR>
    <NAME>${uc(name)}</NAME>
    <SUBC>${subc}</SUBC>
    <RLOAD>E</RLOAD>
    <FIXPT>X</FIXPT>
    <UCCHECK>X</UCCHECK>
   </PROGDIR>${extra}
   <TPOOL>
    <item><ID>R</ID><ENTRY>${xml(title)}</ENTRY><LENGTH>${Math.min(70, title.length)}</LENGTH></item>
${sel.map(([k, t]) => `    <item><ID>S</ID><KEY>${uc(k)}</KEY><ENTRY>        ${xml(t)}</ENTRY><LENGTH>${t.length + 8}</LENGTH></item>`).join('\n')}
   </TPOOL>
  </asx:values>
 </asx:abap>
</abapGit>
`;
const dynField = (type, name, text, line, col, len, fmt, inp, out) => `      <RPY_DYFATC>
       <CONT_TYPE>SCREEN</CONT_TYPE>
       <CONT_NAME>SCREEN</CONT_NAME>
       <TYPE>${type}</TYPE>
       <NAME>${name}</NAME>
       <TEXT>${xml(text)}</TEXT>${line ? `\n       <LINE>${String(line).padStart(3, '0')}</LINE>\n       <COLUMN>${String(col).padStart(3, '0')}</COLUMN>` : ''}
       <LENGTH>${String(len).padStart(3, '0')}</LENGTH>
       <VISLENGTH>${String(len).padStart(3, '0')}</VISLENGTH>
       <HEIGHT>001</HEIGHT>
       <FORMAT>${fmt}</FORMAT>${inp ? '\n       <INPUT_FLD>X</INPUT_FLD>' : ''}${out ? '\n       <OUTPUT_FLD>X</OUTPUT_FLD>' : ''}
      </RPY_DYFATC>`;
const fun = (code, text, extra = '') => `     <RSMPE_FUNT>\n      <CODE>${code}</CODE>\n      <TEXTNO>001</TEXTNO>${extra}\n      <TEXT_TYPE>S</TEXT_TYPE>\n      <FUN_TEXT>${text}</FUN_TEXT>\n     </RSMPE_FUNT>`;

const tranXml = (tcode, prog, screen, text) => `<?xml version="1.0" encoding="utf-8"?>
<abapGit version="v1.0.0" serializer="LCL_OBJECT_TRAN" serializer_version="v1.0.0">
 <asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0">
  <asx:values>
   <TSTC>
    <TCODE>${tcode}</TCODE>
    <PGMNA>${prog}</PGMNA>
    <DYPNO>${screen}</DYPNO>
   </TSTC>
   <TSTCC>
    <TCODE>${tcode}</TCODE>
    <S_WEBGUI>1</S_WEBGUI>
    <S_WIN32>X</S_WIN32>
   </TSTCC>
   <TSTCT>
    <SPRSL>E</SPRSL>
    <TCODE>${tcode}</TCODE>
    <TTEXT>${xml(text)}</TTEXT>
   </TSTCT>
  </asx:values>
 </asx:abap>
</abapGit>
`;

// the files of a new object: { files: { 'src/…': text }, open: 'src/…', notes: [] }
export function objectFiles(kind, o = {}, ctx = {}) {
  const k = KINDS.find(x => x.id === kind);
  if (!k) throw new Error(`Unknown object kind ${kind}`);
  const name = uc(String(o.name || (k.nameFrom ? o[k.nameFrom] : '') || '').trim());
  // lock objects: E + the customer namespace (EZ…)
  const err = checkName(kind === 'enqu' ? name.replace(/^E(?=[ZY])/, '') : name, { max: k.max || 30 });
  if (err) throw Object.assign(new Error(err), { status: 400 });
  const n = lc(name), d = String(o.description || o.title || words(name.replace(/^Z[A-Z]*_/, ''))).trim();
  const files = {}, notes = [];
  const exists = f => ctx.exists?.(f);
  const add = (f, t) => { if (exists(f)) throw Object.assign(new Error(`${f} already exists`), { status: 409 }); files[f] = t; };
  const views = ctx.views || [], tables = ctx.tables || [];
  const view = nm => views.find(v => lc(v.name) === lc(nm));
  const table = nm => tables.find(t => lc(t.name) === lc(nm));
  switch (kind) {
    case 'table': case 'stru': {
      const struct = kind === 'stru';
      const rows = [];
      if (!struct) {
        rows.push('  key client            : abap.clnt not null;');
        if (o.uuidKey !== false && o.uuidKey !== 'false') rows.push(`  key ${n.replace(/_a$/, '').replace(/^z/, '')}_uuid${' '.repeat(Math.max(1, 14 - n.replace(/_a$/, '').replace(/^z/, '').length))}: sysuuid_x16 not null;`);
        rows.push(...ddlComponents(o.keys, { owner: n, ctx, key: true, defaultType: 'abap.char(10)', table: true }));
      }
      rows.push(...ddlComponents(o.fields, { owner: n, ctx, table: !struct }));
      if (!struct && o.admin !== false && o.admin !== 'false') rows.push('  created_by            : abp_creation_user;', '  created_at            : abp_creation_tstmpl;', '  last_changed_by       : abp_lastchange_user;', '  last_changed_at       : abp_lastchange_tstmpl;', '  local_last_changed_at : abp_locinst_lastchange_tstmpl;');
      if (struct && !rows.some(r => /^\s+[a-z_]\w*\s*:|^\s+include /.test(r))) fail('A structure needs at least one component');
      if (!struct && !rows.some(r => /key (?!client)/.test(r))) fail('A table needs a key field besides the client');
      const head = [`@EndUserText.label : '${d.replace(/'/g, "''")}'`];
      if (struct) head.push('@AbapCatalog.enhancement.category : #NOT_EXTENSIBLE');
      else {
        head.push('@AbapCatalog.enhancement.category : #NOT_EXTENSIBLE', '@AbapCatalog.tableCategory : #TRANSPARENT', `@AbapCatalog.deliveryClass : #${uc(o.deliveryClass || 'A')}`, '@AbapCatalog.dataMaintenance : #RESTRICTED');
        if (o.dataClass && o.dataClass !== 'APPL0') head.push(`@AbapCatalog.technicalSettings.dataClass : #${uc(o.dataClass)}`);
        if (o.sizeCategory && String(o.sizeCategory) !== '0') head.push(`@AbapCatalog.technicalSettings.sizeCategory : ${Number(o.sizeCategory) || 0}`);
        if (o.buffering && o.buffering !== 'NOT_ALLOWED') head.push(`@AbapCatalog.technicalSettings.buffering : #${uc(o.buffering)}`);
      }
      add(`src/${n}.tabl.cds`, `${head.join('\n')}\ndefine ${struct ? 'structure' : 'table'} ${n} {\n${rows.join('\n')}\n}\n`);
      for (const r of rows) { const m = /:\s*(z\w+)/i.exec(r); if (m && !struct && !ctx.ddic?.dataElements.has(m[1]) && !(ctx.structures || []).some(x => x.name === m[1])) notes.push(`${m[1].toUpperCase()} is not a data element of this app yet: create it, or the activation reports it.`); }
      if (struct) notes.push(`Use it in ABAP: DATA ls_x TYPE ${n}. Table type: New → Table type with line type ${name}.`);
      break;
    }
    case 'dtel': {
      const dom = uc(String(o.domain || '').trim());
      let typeXml;
      if (dom) {
        if (checkName(dom) === null && !ctx.ddic?.domains.has(lc(dom))) fail(`Domain ${dom} does not exist: create it first (New → Domain) or leave the domain empty for a built-in type`);
        typeXml = `    <DOMNAME>${xml(dom)}</DOMNAME>\n    <REFKIND>D</REFKIND>`;
      } else {
        const t = typeSpec(o.datatype, o.length ?? 10, o.decimals, `Data element ${name}`);
        typeXml = `    <DATATYPE>${t.dt}</DATATYPE>\n    <LENG>${n6(t.len)}</LENG>\n    <DECIMALS>${n6(t.dec)}</DECIMALS>\n    <OUTPUTLEN>${n6(t.out)}</OUTPUTLEN>`;
      }
      const lab = { short: String(o.short || labelOf(d, 10)), medium: String(o.medium || labelOf(d, 20)), long: String(o.long || labelOf(d, 40)), heading: String(o.heading || labelOf(d, 55)) };
      for (const [k, max] of [['short', 10], ['medium', 20], ['long', 40], ['heading', 55]]) if (lab[k].length > max) fail(`The ${k} label has at most ${max} characters`);
      add(`src/${n}.dtel.xml`, `<?xml version="1.0" encoding="utf-8"?>
<abapGit version="v1.0.0" serializer="LCL_OBJECT_DTEL" serializer_version="v1.0.0">
 <asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0">
  <asx:values>
   <DD04V>
    <ROLLNAME>${name}</ROLLNAME>
    <DDLANGUAGE>E</DDLANGUAGE>
${typeXml}
    <HEADLEN>${String(Math.max(lab.heading.length, 1)).padStart(2, '0')}</HEADLEN>
    <SCRLEN1>10</SCRLEN1>
    <SCRLEN2>20</SCRLEN2>
    <SCRLEN3>40</SCRLEN3>
    <DDTEXT>${xml(d)}</DDTEXT>
    <REPTEXT>${xml(lab.heading)}</REPTEXT>
    <SCRTEXT_S>${xml(lab.short)}</SCRTEXT_S>
    <SCRTEXT_M>${xml(lab.medium)}</SCRTEXT_M>
    <SCRTEXT_L>${xml(lab.long)}</SCRTEXT_L>
    <DTELMASTER>E</DTELMASTER>
   </DD04V>
  </asx:values>
 </asx:abap>
</abapGit>
`);
      break;
    }
    case 'doma': {
      const vals = pairs(o.values);
      const t = typeSpec(o.datatype, o.length ?? 1, o.decimals, `Domain ${name}`);
      for (const [v] of vals) {
        if (v.length > t.len && t.len) fail(`Fixed value ${v} is longer than ${t.len}`);
        if (t.dt === 'NUMC' && !/^\d+$/.test(v)) fail(`Fixed value ${v} is not numeric (NUMC)`);
      }
      const yes = v => v === true || v === 'true' || v === 'X';
      const vt = String(o.valueTable || '').trim();
      add(`src/${n}.doma.xml`, `<?xml version="1.0" encoding="utf-8"?>
<abapGit version="v1.0.0" serializer="LCL_OBJECT_DOMA" serializer_version="v1.0.0">
 <asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0">
  <asx:values>
   <DD01V>
    <DOMNAME>${name}</DOMNAME>
    <DDLANGUAGE>E</DDLANGUAGE>
    <DATATYPE>${t.dt}</DATATYPE>
    <LENG>${n6(t.len)}</LENG>
    <OUTPUTLEN>${n6(t.out)}</OUTPUTLEN>${t.dec ? `\n    <DECIMALS>${n6(t.dec)}</DECIMALS>` : ''}${yes(o.sign) ? '\n    <SIGNFLAG>X</SIGNFLAG>' : ''}${yes(o.lowercase) ? '\n    <LOWERCASE>X</LOWERCASE>' : ''}${vals.length ? '\n    <VALEXI>X</VALEXI>' : ''}${vt ? `\n    <ENTITYTAB>${xml(uc(vt))}</ENTITYTAB>` : ''}
    <DDTEXT>${xml(d)}</DDTEXT>
    <DOMMASTER>E</DOMMASTER>
   </DD01V>${vals.length ? `
   <DD07V_TAB>
${vals.map(([v, tx], i) => `    <DD07V>\n     <DOMNAME>${name}</DOMNAME>\n     <VALPOS>${String(i + 1).padStart(4, '0')}</VALPOS>\n     <DDLANGUAGE>E</DDLANGUAGE>\n     <DOMVALUE_L>${xml(v)}</DOMVALUE_L>\n     <DDTEXT>${xml(tx)}</DDTEXT>\n    </DD07V>`).join('\n')}
   </DD07V_TAB>` : ''}
  </asx:values>
 </asx:abap>
</abapGit>
`);
      break;
    }
    case 'ttyp': {
      const row = lc(String(o.rowtype || '').trim());
      if (!row) fail('Name the line type (a structure, a table, a data element or a built-in type like char(10))');
      const isStruct = (ctx.tables || []).some(t => lc(t.name) === row) || (ctx.structures || []).some(t => t.name === row);
      const isDtel = !!ctx.ddic?.dataElements.has(row);
      const builtin = /^abap\.|^(char|numc|dec|string|int4|i|dats|tims)\b/i.test(row) ? ddlType(row) : null;
      if (!isStruct && !isDtel && !builtin && /^[zy]/i.test(row)) fail(`${uc(row)} is not a structure, table or data element of this app`);
      const bm = builtin ? /^abap\.(\w+)(?:\((\d+)(?:,(\d+))?\))?$/.exec(builtin) : null;
      const bt = bm ? Object.entries(DDIC_TYPES).find(([, v]) => v.cds === bm[1])?.[0] || 'CHAR' : null;
      const line = builtin
        ? `    <ROWKIND></ROWKIND>\n    <DATATYPE>${bt}</DATATYPE>\n    <LENG>${n6(bm[2] || (Array.isArray(DDIC_TYPES[bt]?.len) ? 10 : DDIC_TYPES[bt]?.len))}</LENG>\n    <DECIMALS>${n6(bm[3])}</DECIMALS>`
        : `    <ROWTYPE>${uc(row)}</ROWTYPE>\n    <ROWKIND>${isDtel ? 'E' : 'S'}</ROWKIND>\n    <DATATYPE>${isDtel ? 'CHAR' : 'STRU'}</DATATYPE>`;
      add(`src/${n}.ttyp.xml`, `<?xml version="1.0" encoding="utf-8"?>
<abapGit version="v1.0.0" serializer="LCL_OBJECT_TTYP" serializer_version="v1.0.0">
 <asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0">
  <asx:values>
   <DD40V>
    <TYPENAME>${name}</TYPENAME>
    <DDLANGUAGE>E</DDLANGUAGE>
${line}
    <ACCESSMODE>${xml(o.access || 'T')}</ACCESSMODE>
    <KEYDEF>${xml(o.keydef || 'D')}</KEYDEF>
    <KEYKIND>${o.access === 'H' ? 'U' : 'N'}</KEYKIND>
    <DDTEXT>${xml(d)}</DDTEXT>
   </DD40V>
  </asx:values>
 </asx:abap>
</abapGit>
`);
      break;
    }
    case 'enqu': {
      const t = table(o.table);
      if (!t) throw Object.assign(new Error('Choose the table to lock'), { status: 400 });
      const all = t.fields.filter(f => f.key && !/clnt/.test(f.type) && f.name !== 'mandt' && f.name !== 'client');
      const want = String(o.args || '').split(/[\s,]+/).filter(Boolean).map(lc);
      for (const w of want) if (!all.some(f => lc(f.name) === w)) fail(`${uc(w)} is not a key field of ${uc(t.name)}`);
      const keys = want.length ? all.filter(f => want.includes(lc(f.name))) : all;
      const mode = /^[ESXO]$/.test(uc(o.mode || 'E')) ? uc(o.mode || 'E') : 'E';
      const T = uc(t.name);
      add(`src/${n}.enqu.xml`, `<?xml version="1.0" encoding="utf-8"?>
<abapGit version="v1.0.0" serializer="LCL_OBJECT_ENQU" serializer_version="v1.0.0">
 <asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0">
  <asx:values>
   <DD25V>
    <VIEWNAME>${name}</VIEWNAME>
    <DDLANGUAGE>E</DDLANGUAGE>
    <AGGTYPE>E</AGGTYPE>
    <ROOTTAB>${T}</ROOTTAB>
    <DDTEXT>${xml(d)}</DDTEXT>
   </DD25V>
   <DD26E_TABLE>
    <DD26E>
     <VIEWNAME>${name}</VIEWNAME>
     <TABNAME>${T}</TABNAME>
     <TABPOS>0001</TABPOS>
     <FORTABNAME>${T}</FORTABNAME>
     <ENQMODE>${mode}</ENQMODE>
    </DD26E>
   </DD26E_TABLE>
   <DD27P_TABLE>
${keys.map((f, i) => `    <DD27P>\n     <VIEWNAME>${name}</VIEWNAME>\n     <OBJPOS>${String(i + 1).padStart(4, '0')}</OBJPOS>\n     <VIEWFIELD>${uc(f.name)}</VIEWFIELD>\n     <TABNAME>${T}</TABNAME>\n     <FIELDNAME>${uc(f.name)}</FIELDNAME>\n     <KEYFLAG>X</KEYFLAG>\n     <ENQMODE>${mode}</ENQMODE>\n    </DD27P>`).join('\n')}
   </DD27P_TABLE>
  </asx:values>
 </asx:abap>
</abapGit>
`);
      notes.push(`Use CALL FUNCTION 'ENQUEUE_${name}' / 'DEQUEUE_${name}' in classic programs.`);
      break;
    }
    case 'view': {
      const src = table(o.source) || view(o.source);
      if (!src) throw Object.assign(new Error('Choose the data source (a table or a view)'), { status: 400 });
      const isTable = !!table(o.source);
      const kindV = o.viewKind || 'root';
      const els = src.fields.filter(f => !(isTable && (/clnt/.test(f.type || '') || f.include)));
      const elName = f => (isTable ? camel(f.name) : f.name);
      const ann = f => {
        const nm = lc(f.name);
        if (!isTable) return '';
        if (/abp_creation_user/.test(f.type)) return '      @Semantics.user.createdBy: true\n';
        if (/abp_creation_tstmpl/.test(f.type)) return '      @Semantics.systemDateTime.createdAt: true\n';
        if (/abp_lastchange_user/.test(f.type)) return '      @Semantics.user.lastChangedBy: true\n';
        if (/abp_lastchange_tstmpl/.test(f.type)) return '      @Semantics.systemDateTime.lastChangedAt: true\n';
        if (/abp_locinst_lastchange_tstmpl/.test(f.type)) return '      @Semantics.systemDateTime.localInstanceLastChangedAt: true\n';
        void nm; return '';
      };
      const body = els.map(f => `${ann(f)}  ${f.key ? 'key ' : '    '}${isTable ? `${lc(f.name)} as ${elName(f)}` : f.name}`).join(',\n');
      let assoc = '', assocEl = '';
      if (kindV === 'child') {
        const p = view(o.parent);
        if (!p) throw Object.assign(new Error('Choose the parent view'), { status: 400 });
        const pk = p.fields.find(f => f.key)?.name;
        const fk = o.parentKey || els.find(f => !f.key && lc(elName(f)) === lc(pk))?.name;
        if (!fk) throw Object.assign(new Error(`Name the field that holds the parent's key (${pk})`), { status: 400 });
        assoc = `\n  association to parent ${p.name} as _Parent on $projection.${isTable ? camel(fk) : fk} = _Parent.${pk}`;
        assocEl = ',\n      _Parent';
        notes.push(`Add "composition [0..*] of ${name} as _Child" to ${p.name} and "_Child" to its element list.`);
      }
      add(`src/${n}.ddls.asddls`, `@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: '${d}'
define ${kindV === 'root' ? 'root ' : ''}view entity ${name}
  as select from ${lc(src.name)}${assoc}
{
${body}${assocEl}
}
`);
      break;
    }
    case 'projection': {
      const src = view(o.source);
      if (!src) throw Object.assign(new Error('Choose the view to project'), { status: 400 });
      const els = src.fields.filter(f => !f.isAssoc);
      add(`src/${n}.ddls.asddls`, `@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: '${d}'
@Metadata.allowExtensions: true
define ${src.root ? 'root ' : ''}view entity ${name}
  ${src.root ? 'provider contract transactional_query\n  ' : ''}as projection on ${src.name}
{
${els.map(f => `  ${f.key ? 'key ' : '    '}${f.name}`).join(',\n')}
}
`);
      break;
    }
    case 'abstract': {
      add(`src/${n}.ddls.asddls`, `@EndUserText.label: '${d}'
define abstract entity ${name}
{
${pairs(o.fields).map(([f, t]) => `  @EndUserText.label: '${words(f)}'\n  ${f} : ${t || 'abap.char(40)'};`).join('\n')}
}
`);
      break;
    }
    case 'custom': {
      const cls = uc(o.className || `ZCL_${name.replace(/^Z(CE_)?/, '')}_QUERY`).slice(0, 30);
      const fl = pairs(o.fields);
      add(`src/${n}.ddls.asddls`, `@EndUserText.label: '${d}'
@ObjectModel.query.implementedBy: 'ABAP:${cls}'
define custom entity ${name}
{
${fl.map(([f, t], i) => `      @UI.lineItem: [{ position: ${(i + 1) * 10} }]\n  ${i === 0 ? 'key ' : '    '}${f} : ${t || 'abap.char(40)'};`).join('\n')}
}
`);
      add(`src/${lc(cls)}.clas.abap`, `CLASS ${lc(cls)} DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES if_rap_query_provider.
ENDCLASS.

CLASS ${lc(cls)} IMPLEMENTATION.
  METHOD if_rap_query_provider~select.
    TYPES tt_result TYPE STANDARD TABLE OF ${n} WITH EMPTY KEY.
    DATA lt_result TYPE tt_result.
    " fill lt_result from any source (a released API, a calculation, other views)
    lt_result = VALUE #( ( ${fl[0]?.[0] || 'Id'} = '1' ) ).
    IF io_request->is_total_numb_of_rec_requested( ) = abap_true.
      io_response->set_total_number_of_records( lines( lt_result ) ).
    ENDIF.
    IF io_request->is_data_requested( ) = abap_true.
      io_response->set_data( lt_result ).
    ENDIF.
  ENDMETHOD.
ENDCLASS.
`);
      notes.push(`Expose ${name} in a service definition to see it in the preview.`);
      break;
    }
    case 'ddlx': {
      const src = view(o.source || name);
      if (!src) throw Object.assign(new Error('Choose the view to annotate'), { status: 400 });
      const els = src.fields.filter(f => !f.isAssoc);
      const title = els.find(f => !f.key && /name|description|title|text/i.test(f.name)) || els.find(f => !f.key) || els[0];
      const hidden = f => /uuid$/i.test(f.name) || /^(LocalLastChangedAt|LastChangedAt|CreatedBy|CreatedAt|LastChangedBy)$/i.test(f.name);
      const shown = els.filter(f => !hidden(f));
      add(`src/${lc(src.name)}.ddlx.asddlxs`, `@Metadata.layer: #CUSTOMER
@UI.headerInfo: { typeName: '${words(src.name.replace(/^Z[A-Z]_/, ''))}', typeNamePlural: '${words(src.name.replace(/^Z[A-Z]_/, ''))}s',
                  title: { type: #STANDARD, value: '${title?.name}' } }
annotate entity ${src.name} with
{
  @UI.facet: [ { id: 'General', purpose: #STANDARD, type: #IDENTIFICATION_REFERENCE, label: 'General Information', position: 10 } ]
${els.filter(hidden).map(f => `  @UI.hidden: true\n  ${f.name};`).join('\n')}
${shown.map((f, i) => `  @UI: { lineItem: [ { position: ${(i + 1) * 10}${i < 4 ? ', importance: #HIGH' : ''} } ], identification: [ { position: ${(i + 1) * 10} } ]${i < 3 ? `, selectionField: [ { position: ${(i + 1) * 10} } ]` : ''} }\n  ${f.name};`).join('\n')}
}
`);
      return { files, open: `src/${lc(src.name)}.ddlx.asddlxs`, notes };
    }
    case 'dcls': {
      const src = view(o.source || name);
      if (!src) throw Object.assign(new Error('Choose the view to protect'), { status: 400 });
      add(`src/${lc(src.name)}.dcls.asdcls`, `@EndUserText.label: '${d}'
@MappingRole: true
define role ${uc(src.name)} {
  grant select on ${src.name}${o.condition ? `\n    where ${o.condition}` : ''};
}
`);
      return { files, open: `src/${lc(src.name)}.dcls.asdcls`, notes };
    }
    case 'bdef': {
      const src = view(o.source || name);
      if (!src) throw Object.assign(new Error('Choose the root view'), { status: 400 });
      if (o.implType === 'projection') {
        const alias = camel(src.name.replace(/^Z[A-Z]_/, ''));
        add(`src/${lc(src.name)}.bdef.asbdef`, `projection;
strict ( 2 );${o.draft !== false && o.draft !== 'false' ? '\nuse draft;' : ''}

define behavior for ${src.name} alias ${alias}${o.draft !== false && o.draft !== 'false' ? '' : '\nuse etag'}
{
  use create;
  use update;
  use delete;${o.draft !== false && o.draft !== 'false' ? '\n\n  use action Edit;\n  use action Activate;\n  use action Discard;\n  use action Resume;\n  use action Prepare;' : ''}
}
`);
        return { files, open: `src/${lc(src.name)}.bdef.asbdef`, notes };
      }
      if (o.implType === 'unmanaged') {
        const alias = camel(src.name.replace(/^Z[A-Z]_/, ''));
        const pool = `zbp_${lc(src.name.replace(/^z/i, ''))}`.slice(0, 30);
        add(`src/${lc(src.name)}.bdef.asbdef`, `unmanaged implementation in class ${pool} unique;
strict ( 2 );

define behavior for ${src.name} alias ${alias}
lock master
authorization master ( instance )
{
  create;
  update;
  delete;
  field ( readonly : update ) ${src.fields.filter(f => f.key).map(f => f.name).join(', ')};
}
`);
        Object.assign(files, behaviorPool(`src/${lc(src.name)}.bdef.asbdef`, files[`src/${lc(src.name)}.bdef.asbdef`], pool));
        return { files, open: `src/${lc(src.name)}.bdef.asbdef`, notes };
      }
      const t = table(o.table);
      if (!t) throw Object.assign(new Error('Choose the persistent table'), { status: 400 });
      const r = managedBdef({ view: src, table: t, draft: o.draft !== false && o.draft !== 'false', views });
      Object.assign(files, r.files); notes.push(...r.notes);
      return { files, open: `src/${lc(src.name)}.bdef.asbdef`, notes };
    }
    case 'bpool': {
      const f = `src/${lc(o.bdef || '')}.bdef.asbdef`;
      const text = ctx.read?.(f);
      if (!text) throw Object.assign(new Error('Choose the behavior definition'), { status: 400 });
      Object.assign(files, behaviorPool(f, text, n));
      break;
    }
    case 'srvd': {
      const vs = String(o.views || '').split(/[\s,]+/).filter(Boolean);
      if (!vs.length) throw Object.assign(new Error('Choose the views to expose'), { status: 400 });
      add(`src/${n}.srvd.srvdsrv`, `@EndUserText.label: '${d}'
define service ${name} {
${vs.map(v => `  expose ${view(v)?.name || v} as ${camel(String(view(v)?.name || v).replace(/^Z[A-Z]_/i, ''))};`).join('\n')}
}
`);
      break;
    }
    case 'class': {
      const console = /console/.test(o.classKind || '');
      const tests = /unit/.test(o.classKind || '');
      const intfs = [...(console ? ['if_oo_adt_classrun'] : []), ...String(o.interfaces || '').split(/[\s,]+/).filter(Boolean).map(lc)];
      const methods = classMethods(o.methods);
      const sup = String(o.superclass || '').trim();
      if (sup && !/^[\w/]+$/.test(sup)) fail('The superclass is a class name');
      const sec = v => methods.filter(m => m.visibility === v).map(m => `    "! ${m.text || m.name}\n    ${m.static ? 'CLASS-METHODS' : 'METHODS'} ${m.signature}.`).join('\n');
      const sample = !methods.length && (tests || !console);
      add(`src/${n}.clas.abap`, `"! ${d}
CLASS ${n} DEFINITION PUBLIC${sup ? ` INHERITING FROM ${lc(sup)}` : ''} FINAL CREATE PUBLIC.
  PUBLIC SECTION.
${[...intfs.map(i => `    INTERFACES ${i}.`), ...(sample ? ['    "! Adds two numbers', '    METHODS add IMPORTING iv_a TYPE i iv_b TYPE i RETURNING VALUE(rv_sum) TYPE i.'] : []), ...(sec('public') ? [sec('public')] : [])].join('\n')}${sec('protected') ? `\n  PROTECTED SECTION.\n${sec('protected')}` : ''}${sec('private') ? `\n  PRIVATE SECTION.\n${sec('private')}` : ''}
ENDCLASS.

CLASS ${n} IMPLEMENTATION.${console ? `
  METHOD if_oo_adt_classrun~main.
    out->write( |Hello from ${name}| ).
  ENDMETHOD.` : ''}${sample ? `
  METHOD add.
    rv_sum = iv_a + iv_b.
  ENDMETHOD.` : ''}${methods.map(m => `\n  METHOD ${m.name}.\n  ENDMETHOD.`).join('')}
ENDCLASS.
`);
      if (tests) add(`src/${n}.clas.testclasses.abap`, `CLASS ltc_${n.replace(/^zcl_/, '').slice(0, 20)} DEFINITION FINAL FOR TESTING DURATION SHORT RISK LEVEL HARMLESS.
  PRIVATE SECTION.
    METHODS ${sample ? 'add' : 'first_test'} FOR TESTING.
ENDCLASS.

CLASS ltc_${n.replace(/^zcl_/, '').slice(0, 20)} IMPLEMENTATION.
  METHOD ${sample ? 'add' : 'first_test'}.
    ${sample ? `cl_abap_unit_assert=>assert_equals( act = NEW ${n}( )->add( iv_a = 2 iv_b = 3 ) exp = 5 ).` : `cl_abap_unit_assert=>assert_not_initial( act = NEW ${n}( ) ).`}
  ENDMETHOD.
ENDCLASS.
`);
      break;
    }
    case 'exception': {
      const sup = o.superclass || 'cx_static_check';
      const msg = uc(String(o.msgClass || '').trim());
      if (msg) {
        // T100 texts: the message of a message class, its &1 … &4 from attributes of the exception
        if (checkName(msg)) fail(`Message class: ${checkName(msg)}`);
        const no = String(o.msgNo || '001').trim().padStart(3, '0');
        if (!/^\d{3}$/.test(no)) fail('The message number has three digits');
        const attrs = String(o.msgAttrs || '').split(/[\s,]+/).filter(Boolean).map(lc).slice(0, 4);
        for (const a of attrs) if (!/^[a-z_]\w{0,29}$/.test(a)) fail(`${a}: not a valid attribute name`);
        add(`src/${n}.clas.abap`, `"! ${d}
CLASS ${n} DEFINITION PUBLIC INHERITING FROM ${sup} FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES if_t100_dyn_msg.
    "! Message ${msg} ${no}
    CONSTANTS:
      BEGIN OF default_text,
        msgid TYPE symsgid VALUE '${msg}',
        msgno TYPE symsgno VALUE '${no}',
${[0, 1, 2, 3].map(i => `        attr${i + 1} TYPE scx_attrname VALUE '${uc(attrs[i] || '')}',`).join('\n')}
      END OF default_text.
${attrs.map(a => `    DATA ${a} TYPE string READ-ONLY.`).join('\n')}
    METHODS constructor IMPORTING textid LIKE if_t100_message=>t100key OPTIONAL previous LIKE previous OPTIONAL${attrs.map(a => ` ${a} TYPE string OPTIONAL`).join('')}.
ENDCLASS.

CLASS ${n} IMPLEMENTATION.
  METHOD constructor ##ADT_SUPPRESS_GENERATION.
    super->constructor( previous = previous ).
${attrs.map(a => `    me->${a} = ${a}.`).join('\n')}
    CLEAR me->textid.
    IF textid IS INITIAL.
      if_t100_message~t100key = default_text.
    ELSE.
      if_t100_message~t100key = textid.
    ENDIF.
  ENDMETHOD.
ENDCLASS.
`);
        if (!ctx.exists?.(`src/${lc(msg)}.msag.json`)) notes.push(`Message class ${msg} does not exist yet: New → Message class.`);
        notes.push(`RAISE EXCEPTION NEW ${n}( ${attrs.map(a => `${a} = …`).join(' ')} ).`);
        break;
      }
      add(`src/${n}.clas.abap`, `"! ${d}
CLASS ${n} DEFINITION PUBLIC INHERITING FROM ${sup} FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    METHODS constructor IMPORTING textid LIKE textid OPTIONAL previous LIKE previous OPTIONAL text TYPE string OPTIONAL.
    METHODS get_text REDEFINITION.
  PRIVATE SECTION.
    DATA mv_text TYPE string.
ENDCLASS.

CLASS ${n} IMPLEMENTATION.
  METHOD constructor ##ADT_SUPPRESS_GENERATION.
    super->constructor( textid = textid previous = previous ).
    mv_text = text.
  ENDMETHOD.
  METHOD get_text.
    result = COND #( WHEN mv_text IS NOT INITIAL THEN mv_text ELSE |${d}| ).
  ENDMETHOD.
ENDCLASS.
`);
      break;
    }
    case 'intf': {
      add(`src/${n}.intf.abap`, `"! ${d}
INTERFACE ${n} PUBLIC.
  METHODS execute IMPORTING iv_input TYPE string RETURNING VALUE(rv_result) TYPE string.
ENDINTERFACE.
`);
      break;
    }
    case 'report': {
      const t = o.table ? table(o.table) : null;
      const sel = [];
      let src;
      if (t) {
        const key = t.fields.find(f => f.key && !/clnt/.test(f.type) && !/uuid/.test(f.name)) || t.fields.find(f => !f.key && /char|numc/.test(f.type));
        if (key) sel.push(['s_' + key.name.slice(0, 6), words(key.name)]);
        const alv = o.alv !== false && o.alv !== 'false';
        src = `REPORT ${n}.

* ${d}

TABLES ${lc(t.name)}.
${key ? `SELECT-OPTIONS s_${key.name.slice(0, 6)} FOR ${lc(t.name)}-${lc(key.name)}.\n` : ''}PARAMETERS p_max TYPE i DEFAULT 100.

CLASS lcl_report DEFINITION FINAL.
  PUBLIC SECTION.
    CLASS-METHODS run.
ENDCLASS.

CLASS lcl_report IMPLEMENTATION.
  METHOD run.
    SELECT * FROM ${lc(t.name)}${key ? `\n      WHERE ${lc(key.name)} IN @s_${key.name.slice(0, 6)}` : ''}
      INTO TABLE @DATA(lt_rows)
      UP TO @p_max ROWS.
    IF lt_rows IS INITIAL.
      MESSAGE 'No data found' TYPE 'S' DISPLAY LIKE 'E'.
      RETURN.
    ENDIF.
${alv ? `    TRY.
        cl_salv_table=>factory( IMPORTING r_salv_table = DATA(lo_alv) CHANGING t_table = lt_rows ).
        lo_alv->get_functions( )->set_all( abap_true ).
        lo_alv->get_display_settings( )->set_list_header( |${d}: { lines( lt_rows ) } rows| ).
        lo_alv->display( ).
      CATCH cx_salv_msg INTO DATA(lx_salv).
        MESSAGE lx_salv TYPE 'E'.
    ENDTRY.` : `    WRITE: / |${d}: { lines( lt_rows ) } rows|.
    LOOP AT lt_rows INTO DATA(ls_row).
      WRITE: / ${t.fields.filter(f => !/clnt|uuid|abp_/.test(`${f.type} ${f.name}`)).slice(0, 4).map(f => `ls_row-${lc(f.name)}`).join(', ') || "'row'"}.
    ENDLOOP.`}
  ENDMETHOD.
ENDCLASS.

START-OF-SELECTION.
  lcl_report=>run( ).
`;
      } else {
        sel.push(['p_name', 'Name']);
        src = `REPORT ${n}.

* ${d}

PARAMETERS p_name TYPE c LENGTH 40 LOWER CASE DEFAULT 'World'.

START-OF-SELECTION.
  WRITE: / |Hello { p_name }!|.
  WRITE: / |Today is { sy-datum DATE = USER }|.
`;
      }
      sel.push(['p_max', 'Maximum rows']);
      add(`src/${n}.prog.abap`, src);
      // selection texts only for the parameters the program has (no leftovers of the template)
      const params = new Set(selectionNames(src));
      add(`src/${n}.prog.xml`, progXml(name, '1', d, sel.filter(([k]) => params.has(uc(k)))));
      break;
    }
    case 'modulepool': {
      const tcode = uc(o.tcode || name.replace(/^Z/, 'Z').slice(0, 20));
      add(`src/${n}.prog.abap`, `PROGRAM ${n}.

* ${d}: screen 0100 with an input field and a result, GUI status MAIN, transaction ${tcode}

DATA gv_ok_code TYPE sy-ucomm.
DATA gv_input TYPE c LENGTH 40.
DATA gv_result TYPE c LENGTH 60.

MODULE status_0100 OUTPUT.
  SET PF-STATUS 'MAIN'.
  SET TITLEBAR 'MAIN'.
ENDMODULE.

MODULE exit_0100 INPUT.
  CLEAR gv_ok_code.
  LEAVE TO SCREEN 0.
ENDMODULE.

MODULE user_command_0100 INPUT.
  CASE gv_ok_code.
    WHEN 'SHOW'.
      gv_result = |Hello { gv_input }|.
      MESSAGE |Done| TYPE 'S'.
  ENDCASE.
  CLEAR gv_ok_code.
ENDMODULE.
`);
      add(`src/${n}.prog.screen_0100.abap`, `PROCESS BEFORE OUTPUT.
  MODULE status_0100.

PROCESS AFTER INPUT.
  MODULE exit_0100 AT EXIT-COMMAND.
  MODULE user_command_0100.
`);
      const dyn = `
   <DYNPROS>
    <item>
     <HEADER>
      <PROGRAM>${name}</PROGRAM>
      <SCREEN>0100</SCREEN>
      <LANGUAGE>E</LANGUAGE>
      <DESCRIPT>${xml(d)}</DESCRIPT>
      <TYPE>N</TYPE>
      <NEXTSCREEN>0100</NEXTSCREEN>
      <LINES>024</LINES>
      <COLUMNS>080</COLUMNS>
     </HEADER>
     <CONTAINERS>
      <RPY_DYCATT>
       <TYPE>SCREEN</TYPE>
       <NAME>SCREEN</NAME>
      </RPY_DYCATT>
     </CONTAINERS>
     <FIELDS>
${dynField('TEXT', 'LBL_INPUT', 'Input', 1, 1, 14, 'CHAR')}
${dynField('TEMPLATE', 'GV_INPUT', '_'.repeat(40), 1, 16, 40, 'CHAR', true, true)}
${dynField('TEXT', 'LBL_RESULT', 'Result', 2, 1, 14, 'CHAR')}
${dynField('TEMPLATE', 'GV_RESULT', '_'.repeat(60), 2, 16, 60, 'CHAR', false, true)}
${dynField('OKCODE', 'GV_OK_CODE', '_'.repeat(20), 0, 0, 20, 'CHAR', true)}
     </FIELDS>
    </item>
   </DYNPROS>
   <CUA>
    <ADM>
     <ACTCODE>000001</ACTCODE>
     <PFKCODE>000001</PFKCODE>
    </ADM>
    <STA>
     <RSMPE_STAT>
      <CODE>MAIN</CODE>
      <MODAL>D</MODAL>
      <ACTCODE>000001</ACTCODE>
      <PFKCODE>000001</PFKCODE>
      <BUTCODE>0001</BUTCODE>
      <INT_NOTE>${xml(d)}</INT_NOTE>
     </RSMPE_STAT>
    </STA>
    <FUN>
${fun('BACK', 'Back', '\n      <TYPE>E</TYPE>')}
${fun('CANCEL', 'Cancel', '\n      <TYPE>E</TYPE>')}
${fun('EXIT', 'Exit', '\n      <TYPE>E</TYPE>')}
${fun('SHOW', 'Execute', '\n      <TEXT_NAME>ICON_EXECUTE_OBJECT</TEXT_NAME>\n      <ICON_ID>@15@</ICON_ID>\n      <ICON_TEXT>Execute</ICON_TEXT>')}
    </FUN>
    <BUT>
     <RSMPE_BUT>
      <PFK_CODE>000001</PFK_CODE>
      <CODE>0001</CODE>
      <NO>01</NO>
      <PFNO>08</PFNO>
     </RSMPE_BUT>
    </BUT>
    <PFK>
${[['03', 'BACK'], ['15', 'EXIT'], ['12', 'CANCEL'], ['08', 'SHOW']].map(([p, c]) => `     <RSMPE_PFK>\n      <CODE>000001</CODE>\n      <PFNO>${p}</PFNO>\n      <FUNCODE>${c}</FUNCODE>\n      <FUNNO>001</FUNNO>\n     </RSMPE_PFK>`).join('\n')}
    </PFK>
    <SET>
${['BACK', 'EXIT', 'CANCEL', 'SHOW'].map(c => `     <RSMPE_STAF>\n      <STATUS>MAIN</STATUS>\n      <FUNCTION>${c}</FUNCTION>\n     </RSMPE_STAF>`).join('\n')}
    </SET>
    <TIT>
     <RSMPE_TITT>
      <CODE>MAIN</CODE>
      <TEXT>${xml(d)}</TEXT>
     </RSMPE_TITT>
    </TIT>
   </CUA>`;
      add(`src/${n}.prog.xml`, progXml(name, 'M', d, [], dyn));
      add(`src/${lc(tcode)}.tran.xml`, tranXml(tcode, name, '0100', d));
      break;
    }
    case 'fugr': {
      const fm = lc(o.fm || `z_${n.replace(/^z/, '')}_get`);
      if (checkName(fm)) fail(`Function module: ${checkName(fm)}`);
      if ((ctx.functions || []).some(f => f.fm === fm && f.group !== n)) fail(`Function module ${uc(fm)} exists already in another function group`);
      let iface;
      try { iface = String(o.params || '').trim() ? paramsFromLines(o.params) : { params: [{ section: 'IMPORTING', name: 'IV_TEXT', typing: 'TYPE', type: 'STRING', byValue: true }, { section: 'EXPORTING', name: 'EV_RESULT', typing: 'TYPE', type: 'STRING', byValue: true }], exceptions: ['EMPTY_INPUT'] }; } catch (e) { fail(e.message); }
      const bad = checkFm(iface);
      if (bad.length) fail(bad.join('; '));
      const sample = !String(o.params || '').trim();
      // a new group gets its TOP include (global data of the group; the description as its comment)
      if (!exists(`src/${n}.fugr.l${n}top.abap`) && !(ctx.functions || []).some(f => f.group === n)) add(`src/${n}.fugr.l${n}top.abap`, `FUNCTION-POOL ${n}.${d ? `   " ${d}` : ''}\n\n* global data of the function group\n`);
      add(`src/${n}.fugr.${fm}.abap`, `FUNCTION ${fm}.${o.fmText ? `   " ${String(o.fmText).replace(/\n/g, ' ')}` : ''}
${interfaceBlock(iface)}${sample ? `  IF iv_text IS INITIAL.
    RAISE empty_input.
  ENDIF.
  ev_result = to_upper( iv_text ).
` : `
`}ENDFUNCTION.
`);
      if (!sample) notes.push('Edit the parameters in the Design view of the function module; F8 opens its test page.');
      return { files, open: `src/${n}.fugr.${fm}.abap`, notes };
    }
    case 'tran': {
      const prog = (ctx.programs || []).find(p => p.name === lc(o.program || ''));
      if (!prog) fail('Choose the program the transaction starts');
      if (name.length > 20) fail('A transaction code has at most 20 characters');
      const screen = prog.subc === 'M' ? String(o.screen || prog.screens[0] || '0100').padStart(4, '0') : '1000';
      if (prog.subc === 'M' && prog.screens.length && !prog.screens.includes(screen)) fail(`${uc(prog.name)} has no screen ${screen} (screens: ${prog.screens.join(', ')})`);
      add(`src/${n}.tran.xml`, tranXml(name, uc(prog.name), screen, d));
      break;
    }
    case 'sfpi': {
      const params = parseParams(o.params);
      if (!params.length) fail('Name at least one import parameter (e.g. IS_HEADER TYPE ZPO_S_HEADER)');
      const resolved = resolveParams(params, ctx.model);
      for (const p of resolved) if (p.shape === 'elem' && /^[zy]/i.test(p.type) && !ctx.ddic?.dataElements.has(lc(p.type))) fail(`${p.name}: type ${p.type} does not exist in this app (a structure, a table type or a data element)`);
      const global = parseParams(o.global);
      const clash = global.find(g => params.some(p => p.name === g.name));
      if (clash) fail(`${clash.name} is an import parameter and global data`);
      add(`src/${n}.sfpi.json`, `${JSON.stringify({ description: d, parameters: params, ...(global.length ? { global } : {}), ...(String(o.init || '').trim() ? { init: String(o.init).replace(/\s+$/, '') } : {}) }, null, 1)}\n`);
      notes.push(`Use it in an Adobe form: New → Adobe form, Data: form interface ${name}.`);
      break;
    }
    case 'msag': {
      const msgs = Object.fromEntries(pairs(o.messages).map(([nr, t]) => [String(nr).padStart(3, '0'), t]));
      add(`src/${n}.msag.json`, `${JSON.stringify(Object.keys(msgs).length ? msgs : { '001': '&1 was saved' }, null, 2)}\n`);
      break;
    }
    case 'xdpform': {
      const title = o.title || d;
      if (o.source === 'provider' || (o.dataProvider && !o.interface && !String(o.params || '').trim())) {
        if (!o.dataProvider) fail('Choose the data provider (a service definition with a leading entity)');
        if (!ctx.xdp) fail('The starter layout needs an activated data provider');
        add(`src/${n}.xdp`, ctx.xdp(o.dataProvider, title));
        add(`src/${n}.form.json`, `${JSON.stringify({ title, layout: `${n}.xdp`, dataProvider: uc(o.dataProvider) }, null, 1)}\n`);
        return { files, open: `src/${n}.xdp`, notes };
      }
      // a classic form: its interface (an existing one, or a new one from the parameters typed here)
      let ifName = uc(o.interface || ''), params;
      if (ifName) {
        const itf = ctx.dir ? loadInterface(ctx.dir, ifName) : null;
        if (!itf) fail(`Form interface ${ifName} does not exist`);
        params = [...(itf.parameters || []), ...(itf.global || [])];
      } else {
        params = parseParams(o.params);
        if (!params.length) fail('Choose a form interface or type its import parameters (e.g. IS_HEADER TYPE ZPO_S_HEADER)');
        ifName = `${name.replace(/^ZF_/, 'Z')}_IF`.slice(0, 30);
        add(`src/${lc(ifName)}.sfpi.json`, `${JSON.stringify({ description: `Interface of ${name}`, parameters: params }, null, 1)}\n`);
      }
      const resolved = resolveParams(params, ctx.model);
      for (const p of resolved) if (p.shape === 'elem' && /^[zy]/i.test(p.type) && !ctx.ddic?.dataElements.has(lc(p.type))) fail(`${p.name}: type ${p.type} does not exist in this app (create the structure / table type first)`);
      add(`src/${n}.xdp`, generateXdpFromInterface({ title, params: resolved }));
      add(`src/${n}.form.json`, `${JSON.stringify({ title, layout: `${n}.xdp`, interface: ifName }, null, 1)}\n`);
      notes.push(`Driver program: ${signature(name, resolved).split('\n').slice(0, 1)[0].replace(/^CALL FUNCTION lv_fm_name\s+" /, '')} gives the function module; pass ${resolved.map(p => p.name).join(', ')} to it.`);
      return { files, open: `src/${n}.xdp`, notes };
    }
    case 'jsonform': {
      const form = { title: o.title || d, styles: { h1: { size: 18, bold: true, color: '#0a3d7a' } }, ...(o.dataProvider ? { dataProvider: uc(o.dataProvider) } : { sample: { name: 'RAP Studio' } }), page: { size: 'A4', margin: '20mm' },
        footer: [{ text: 'Page {page} of {pages}', align: 'right', size: 8 }],
        content: [{ text: o.title || d, style: 'h1' }, { line: true }, { text: o.dataProvider ? 'Drag fields from the Data View in the Design view.' : 'Hello {name}' }] };
      add(`src/${n}.form.json`, `${JSON.stringify(form, null, 2)}\n`);
      break;
    }
    case 'xslt': {
      add(`src/${n}.xslt.source.xml`, `<?sap.transform simple?>
<tt:transform xmlns:tt="http://www.sap.com/transformation-templates">
  <tt:root name="ROWS"/>
  <tt:template>
    <Rows>
      <tt:loop ref=".ROWS" name="r">
        <Row>
          <tt:attribute name="id" value-ref="$r.ID"/>
          <Name><tt:value ref="$r.NAME"/></Name>
        </Row>
      </tt:loop>
    </Rows>
  </tt:template>
</tt:transform>
`);
      break;
    }
    case 'job': {
      const base = n.replace(/^zjc_/, '');
      const cls = `zcl_${base}_job`.slice(0, 30);
      add(`src/${n}.sajc.json`, `${JSON.stringify({ formatVersion: '1', header: { description: d, originalLanguage: 'en' }, generalInformation: { className: uc(cls) } }, null, 2)}\n`);
      add(`src/zjt_${base}.sajt.json`.slice(0, 60), `${JSON.stringify({ formatVersion: '1', header: { description: `${d} (template)`, originalLanguage: 'en' }, generalInformation: { catalogName: name } }, null, 2)}\n`);
      add(`src/${cls}.clas.abap`, `CLASS ${cls} DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES if_apj_dt_exec_object.
    INTERFACES if_apj_rt_exec_object.
ENDCLASS.

CLASS ${cls} IMPLEMENTATION.
  METHOD if_apj_dt_exec_object~get_parameters.
    et_parameter_def = VALUE #( ( selname = 'P_TEXT' kind = 'P' datatype = 'C' length = 40 param_text = 'Text' changeable_ind = abap_true ) ).
  ENDMETHOD.

  METHOD if_apj_rt_exec_object~execute.
    DATA(text) = VALUE #( it_parameters[ selname = 'P_TEXT' ]-low OPTIONAL ).
    DATA(log) = cl_bali_log=>create_with_header( cl_bali_header_setter=>create( object = 'ZJOB' subobject = 'RUN' ) ).
    log->add_item( cl_bali_free_text_setter=>create( severity = if_bali_constants=>c_severity_status text = |${d}: { text }| ) ).
    cl_bali_log_db=>get_instance( )->save_log( log = log assign_to_current_appl_job = abap_true ).
  ENDMETHOD.
ENDCLASS.
`);
      return { files, open: `src/${cls}.clas.abap`, notes };
    }
    case 'bgpf': {
      add(`src/${n}.clas.abap`, `"! ${d}: a background operation, started after the commit with
"! cl_bgmc_process_factory=>get_default( )->create( )->set_operation( NEW ${n}( \`text\` ) )->save_for_execution( )
CLASS ${n} DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES if_bgmc_op_single_tx_uncontr.
    METHODS constructor IMPORTING text TYPE string.
  PRIVATE SECTION.
    DATA mv_text TYPE string.
ENDCLASS.

CLASS ${n} IMPLEMENTATION.
  METHOD constructor.
    mv_text = text.
  ENDMETHOD.

  METHOD if_bgmc_op_single_tx_uncontr~execute.
    DATA(log) = cl_bali_log=>create_with_header( cl_bali_header_setter=>create( object = 'ZBGPF' subobject = 'RUN' ) ).
    log->add_item( cl_bali_free_text_setter=>create( severity = if_bali_constants=>c_severity_status text = mv_text ) ).
    cl_bali_log_db=>get_instance( )->save_log( log ).
  ENDMETHOD.
ENDCLASS.
`);
      break;
    }
    default: throw new Error(`No template for ${kind}`);
  }
  return { files, open: Object.keys(files)[0], notes };
}

// ---------------------------------------------------------------- behavior: definitions and pools
// a managed BDEF for a root view on a table (draft: the draft table too); the behavior pool for it
function managedBdef({ view, table, draft, views = [] }) {
  const files = {}, notes = [];
  const cols = table.fields.filter(f => !/clnt/.test(f.type) && !f.include);
  const byCol = new Map(cols.map(f => [lc(f.name), f]));
  // view elements that are columns of the table (alias = element)
  const els = view.fields.filter(f => !f.isAssoc && !f.virtual).map(f => ({ el: f.name, col: f.column || [...byCol.keys()].find(c => lc(camel(c)) === lc(f.name) || c === lc(f.name)) })).filter(x => x.col);
  const typeOf = col => byCol.get(col)?.type || '';
  const elOfType = re => els.find(x => re.test(typeOf(x.col)))?.el;
  const lastChanged = elOfType(/abp_lastchange_tstmpl/), local = elOfType(/abp_locinst_lastchange_tstmpl/);
  if (draft && !(lastChanged && local)) { draft = false; notes.push('Draft needs the fields "last changed at" (abp_lastchange_tstmpl) and "local last changed at" (abp_locinst_lastchange_tstmpl) in the table: generated without draft.'); }
  const keys = view.fields.filter(f => f.key);
  const uuidKey = keys.length === 1 && /sysuuid_x16/.test(typeOf(els.find(x => x.el === keys[0].name)?.col || '')) ? keys[0].name : null;
  const admin = els.filter(x => /abp_/.test(typeOf(x.col))).map(x => x.el);
  const alias = camel(view.name.replace(/^Z[A-Z]_/i, '')) || 'Root';
  const pool = `zbp_${lc(view.name.replace(/^z/i, ''))}`.slice(0, 30);
  const draftTable = draft ? `${lc(table.name).replace(/_a$/, '').slice(0, 14)}_d` : null;
  const bdef = `managed implementation in class ${pool} unique;
strict ( 2 );${draft ? '\nwith draft;' : ''}

define behavior for ${view.name} alias ${alias}
persistent table ${lc(table.name)}${draft ? `\ndraft table ${draftTable}` : ''}
lock master${draft ? `\ntotal etag ${lastChanged}` : ''}
authorization master ( instance )${local ? `\netag master ${local}` : ''}
{
  create;
  update;
  delete;

  field ( ${uuidKey ? 'numbering : managed, readonly' : 'readonly : update'} ) ${uuidKey || keys.map(k => k.name).join(', ')};${admin.length ? `\n  field ( readonly ) ${admin.join(', ')};` : ''}${draft ? `

  draft action Edit;
  draft action Activate optimized;
  draft action Discard;
  draft action Resume;
  draft determine action Prepare;` : ''}

  mapping for ${lc(table.name)}
  {
${els.map(x => `    ${x.el.padEnd(Math.max(...els.map(y => y.el.length)))} = ${x.col};`).join('\n')}
  }
}
`;
  files[`src/${lc(view.name)}.bdef.asbdef`] = bdef;
  if (draft) {
    const w = Math.max(...els.map(x => x.el.length)) + 2;
    files[`src/${draftTable}.tabl.cds`] = `@EndUserText.label : '${view.name} - draft table'
define table ${draftTable} {
  key mandt${' '.repeat(Math.max(1, w - 5))}: abap.clnt not null;
${els.map(x => `  ${keys.some(k => k.name === x.el) ? 'key ' : ''}${lc(x.el).padEnd(keys.some(k => k.name === x.el) ? w - 4 : w)}: ${typeOf(x.col)}${keys.some(k => k.name === x.el) ? ' not null' : ''};`).join('\n')}
  "%admin"${' '.repeat(Math.max(1, w - 8))}: include sych_bdl_draft_admin_inc;
}
`;
  }
  Object.assign(files, behaviorPool(`src/${lc(view.name)}.bdef.asbdef`, bdef, pool));
  void views;
  return { files, notes, draft, alias, pool };
}

// the behavior pool of a behavior definition: a handler class per entity with every method the BDEF declares
export function behaviorPool(bdefFile, text, pool) {
  const files = {};
  const root = /define behavior for\s+(\w+)/i.exec(text)?.[1];
  if (!root) throw Object.assign(new Error('The behavior definition has no "define behavior for"'), { status: 400 });
  const unmanaged = /^\s*unmanaged/i.test(text);
  const entities = [...text.matchAll(/define behavior for\s+(\w+)(?:\s+alias\s+(\w+))?([\s\S]*?)(?=define behavior for|$)/gi)].map(m => ({ entity: m[1], alias: m[2] || m[1], body: m[3] }));
  const handlers = [];
  for (const e of entities) {
    const defs = [], impls = [];
    const A = e.alias;
    if (/authorization master\s*\(\s*instance\s*\)/i.test(e.body)) { defs.push(`    METHODS get_instance_authorizations FOR INSTANCE AUTHORIZATION\n      IMPORTING keys REQUEST requested_authorizations FOR ${A} RESULT result.`); impls.push(`  METHOD get_instance_authorizations.\n    " everyone may do everything; check authorizations here (AUTHORITY-CHECK) and return if_abap_behv=>auth-unauthorized\n  ENDMETHOD.`); }
    if (/authorization master\s*\(\s*global\s*\)/i.test(e.body)) { defs.push(`    METHODS get_global_authorizations FOR GLOBAL AUTHORIZATION\n      IMPORTING REQUEST requested_authorizations FOR ${A} RESULT result.`); impls.push('  METHOD get_global_authorizations.\n  ENDMETHOD.'); }
    if (/features\s*:\s*instance/i.test(e.body)) { defs.push(`    METHODS get_instance_features FOR INSTANCE FEATURES\n      IMPORTING keys REQUEST requested_features FOR ${A} RESULT result.`); impls.push('  METHOD get_instance_features.\n  ENDMETHOD.'); }
    for (const m of e.body.matchAll(/determination\s+(\w+)\s+on\s+(modify|save)/gi)) { defs.push(`    METHODS ${m[1]} FOR DETERMINE ON ${m[2].toUpperCase()}\n      IMPORTING keys FOR ${A}~${m[1]}.`); impls.push(`  METHOD ${m[1]}.\n  ENDMETHOD.`); }
    for (const m of e.body.matchAll(/validation\s+(\w+)\s+on\s+save/gi)) { defs.push(`    METHODS ${m[1]} FOR VALIDATE ON SAVE\n      IMPORTING keys FOR ${A}~${m[1]}.`); impls.push(`  METHOD ${m[1]}.\n  ENDMETHOD.`); }
    for (const m of e.body.matchAll(/^\s*(?:internal\s+)?(?:static\s+)?action\s*(?:\([^)]*\))?\s*(\w+)([^;]*);/gim)) {
      const hasResult = /result/i.test(m[2]);
      defs.push(`    METHODS ${m[1]} FOR MODIFY\n      IMPORTING keys FOR ACTION ${A}~${m[1]}${hasResult ? ' RESULT result' : ''}.`);
      impls.push(`  METHOD ${m[1]}.\n  ENDMETHOD.`);
    }
    if (unmanaged) {
      if (/^\s*create\s*[;(]/im.test(e.body)) { defs.push(`    METHODS create FOR MODIFY\n      IMPORTING entities FOR CREATE ${A}.`); impls.push('  METHOD create.\n  ENDMETHOD.'); }
      if (/^\s*update\s*[;(]/im.test(e.body)) { defs.push(`    METHODS update FOR MODIFY\n      IMPORTING entities FOR UPDATE ${A}.`); impls.push('  METHOD update.\n  ENDMETHOD.'); }
      if (/^\s*delete\s*[;(]/im.test(e.body)) { defs.push(`    METHODS delete FOR MODIFY\n      IMPORTING keys FOR DELETE ${A}.`); impls.push('  METHOD delete.\n  ENDMETHOD.'); }
      defs.push(`    METHODS read FOR READ\n      IMPORTING keys FOR READ ${A} RESULT result.`); impls.push('  METHOD read.\n  ENDMETHOD.');
      if (/lock master/i.test(e.body)) { defs.push(`    METHODS lock FOR LOCK\n      IMPORTING keys FOR LOCK ${A}.`); impls.push('  METHOD lock.\n  ENDMETHOD.'); }
    }
    if (!defs.length) continue;
    const cls = `lhc_${lc(A)}`.slice(0, 30);
    handlers.push(`CLASS ${cls} DEFINITION INHERITING FROM cl_abap_behavior_handler.\n  PRIVATE SECTION.\n${defs.join('\n')}\nENDCLASS.\n\nCLASS ${cls} IMPLEMENTATION.\n${impls.join('\n\n')}\nENDCLASS.`);
  }
  if (unmanaged) handlers.push(`CLASS lsc_${lc(entities[0].alias)} DEFINITION INHERITING FROM cl_abap_behavior_saver.\n  PROTECTED SECTION.\n    METHODS save REDEFINITION.\nENDCLASS.\n\nCLASS lsc_${lc(entities[0].alias)} IMPLEMENTATION.\n  METHOD save.\n  ENDMETHOD.\nENDCLASS.`);
  files[`src/${lc(pool)}.clas.abap`] = `CLASS ${lc(pool)} DEFINITION PUBLIC ABSTRACT FINAL FOR BEHAVIOR OF ${lc(root)}.\nENDCLASS.\n\nCLASS ${lc(pool)} IMPLEMENTATION.\nENDCLASS.\n`;
  files[`src/${lc(pool)}.clas.locals_imp.abap`] = `${handlers.join('\n\n')}\n`;
  void bdefFile;
  return files;
}

// ---------------------------------------------------------------- the RAP business object generator
// table -> ZR_ root view, ZC_ projection, metadata extension, managed BDEF (+ draft table), projection BDEF,
// behavior pool, service definition (+ the Fiori elements app once the service is active: the caller)
export function rapBoFiles(ctx, { table: tableName, name, draft = true }) {
  const t = (ctx.tables || []).find(x => lc(x.name) === lc(tableName));
  if (!t) throw Object.assign(new Error(`Table ${tableName} not found in this app`), { status: 400 });
  const base = uc(name || camel(lc(t.name).replace(/^z/, '').replace(/_a$/, ''))).replace(/[^A-Z0-9_]/g, '');
  const Base = name && /[a-z]/.test(name) && /[A-Z]/.test(name) ? String(name).replace(/[^A-Za-z0-9]/g, "") : camel(lc(base));
  const R = `ZR_${Base}`, C = `ZC_${Base}`, S = `ZUI_${base}`.slice(0, 30);
  for (const n of [R, C, S]) { const e = checkName(n); if (e) throw Object.assign(new Error(`${n}: ${e}`), { status: 400 }); }
  const notes = [];
  const exists = f => ctx.exists?.(f);
  const cols = t.fields.filter(f => !/clnt/.test(f.type) && !f.include);
  if (!cols.some(f => f.key)) throw Object.assign(new Error('The table has no key field besides the client'), { status: 400 });
  const ann = f => (/abp_creation_user/.test(f.type) ? '      @Semantics.user.createdBy: true\n' : /abp_creation_tstmpl/.test(f.type) ? '      @Semantics.systemDateTime.createdAt: true\n'
    : /abp_lastchange_user/.test(f.type) ? '      @Semantics.user.lastChangedBy: true\n' : /abp_lastchange_tstmpl/.test(f.type) ? '      @Semantics.systemDateTime.lastChangedAt: true\n'
      : /abp_locinst_lastchange_tstmpl/.test(f.type) ? '      @Semantics.systemDateTime.localInstanceLastChangedAt: true\n'
        : /abap\.curr/.test(f.type) && cols.some(c => /cuky/.test(c.type)) ? `      @Semantics.amount.currencyCode: '${camel(cols.find(c => /cuky/.test(c.type)).name)}'\n` : '');
  const files = {};
  files[`src/${lc(R)}.ddls.asddls`] = `@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: '${words(Base)}'
define root view entity ${R}
  as select from ${lc(t.name)}
{
${cols.map(f => `${ann(f)}  ${f.key ? 'key ' : '    '}${lc(f.name)} as ${camel(f.name)}`).join(',\n')}
}
`;
  const viewR = { name: R, root: true, fields: cols.map(f => ({ name: camel(f.name), key: f.key, column: lc(f.name) })) };
  files[`src/${lc(C)}.ddls.asddls`] = `@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: '${words(Base)} - projection'
@Metadata.allowExtensions: true
define root view entity ${C}
  provider contract transactional_query
  as projection on ${R}
{
${cols.map(f => `  ${f.key ? 'key ' : '    '}${camel(f.name)}`).join(',\n')}
}
`;
  const viewC = { name: C, root: true, fields: viewR.fields.map(f => ({ name: f.name, key: f.key })) };
  Object.assign(files, objectFiles('ddlx', { source: C }, { views: [viewC] }).files);
  const m = managedBdef({ view: viewR, table: t, draft, views: [] });
  Object.assign(files, m.files); notes.push(...m.notes);
  files[`src/${lc(C)}.bdef.asbdef`] = `projection;
strict ( 2 );${m.draft ? '\nuse draft;' : ''}

define behavior for ${C} alias ${m.alias}${m.draft ? '' : '\nuse etag'}
{
  use create;
  use update;
  use delete;${m.draft ? '\n\n  use action Edit;\n  use action Activate;\n  use action Discard;\n  use action Resume;\n  use action Prepare;' : ''}
}
`;
  files[`src/${lc(S)}.srvd.srvdsrv`] = `@EndUserText.label: '${words(Base)}'
define service ${S} {
  expose ${C} as ${m.alias};
}
`;
  const clash = Object.keys(files).filter(exists);
  if (clash.length) throw Object.assign(new Error(`These objects exist already: ${clash.join(', ')}`), { status: 409 });
  return { files, open: `src/${lc(C)}.ddls.asddls`, notes, service: S, entitySet: m.alias, draft: m.draft };
}

// ---------------------------------------------------------------- context of an app (for the dialog and the templates)
export function appContext(ws) {
  const src = path.join(ws.dir, 'src');
  const list = fs.existsSync(src) ? fs.readdirSync(src) : [];
  const read = f => { try { return fs.readFileSync(path.join(src, f), 'utf8'); } catch { return ''; } };
  const defs = list.filter(f => f.endsWith('.tabl.cds')).map(f => parseTable(read(f))).filter(t => t.name);
  const tables = defs.filter(t => t.kind === 'table'), structures = defs.filter(t => t.kind === 'structure').map(t => ({ ...t, name: lc(t.name) }));
  const model = ws.app?.model;
  const views = [];
  for (const e of model?.entities?.values() || []) {
    if (e.kind !== 'view' || !e.file || !(String(e.file).startsWith('src/') || String(e.file).startsWith(src))) continue;
    views.push({ name: e.label || e.name, root: !!e.root, projection: !!e.projection, fields: e.fields.filter(f => !f.isAssoc).map(f => ({ name: f.label || f.name, key: !!f.key })) });
  }
  const bdefs = list.filter(f => f.endsWith('.bdef.asbdef')).map(f => f.replace(/\.bdef\.asbdef$/, ''));
  const services = [...(model?.services?.values() || [])].filter(s => /^src\//.test(String(s.file || '')) || String(s.file || '').startsWith(src)).map(s => s.label || s.name);
  const ddic = model?.ddic || readDdic(listSources(ws.dir));
  const programs = list.filter(f => /\.prog\.abap$/.test(f)).map(f => {
    const nm = f.split('.')[0], x = read(`${nm}.prog.xml`);
    return { name: nm, subc: /<SUBC>([^<]*)<\/SUBC>/.exec(x)?.[1] || '1', screens: [...x.matchAll(/<SCREEN>(\d+)<\/SCREEN>/g)].map(m => m[1]) };
  });
  const functions = list.map(f => /^([\w$#]+)\.fugr\.([\w$#]+)\.abap$/.exec(f)).filter(m => m && !/^(sapl|l\w+top$|l\w+uxx$)/.test(m[2])).map(m => ({ group: m[1], fm: m[2] }));
  const interfaces = list.filter(f => f.endsWith('.sfpi.json')).map(f => f.split('.')[0].toUpperCase());
  let meta = {};
  for (const f of [path.join(ws.dir, '.app.json'), path.join(ws.dir, '.rap', 'app.json')]) { try { meta = { ...meta, ...JSON.parse(fs.readFileSync(f, 'utf8')) }; } catch {} }
  // RAP or classic: what the app was created as, else what it holds (UUID keys and admin fields only for RAP)
  const flavor = meta.flavor || meta.ui?.kind || (bdefs.length || services.length ? 'rap' : programs.length || functions.length ? 'classic' : 'rap');
  return { dir: ws.dir, model, tables, structures, views, bdefs, services, ddic, programs, functions, interfaces, flavor: flavor === 'forms' ? 'classic' : flavor === 'classic' ? 'classic' : 'rap',
    exists: f => fs.existsSync(path.join(ws.dir, f)), read: f => (fs.existsSync(path.join(ws.dir, f)) ? fs.readFileSync(path.join(ws.dir, f), 'utf8') : null) };
}
