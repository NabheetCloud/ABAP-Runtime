// Form interfaces of classic Adobe forms (SFP interface): the import parameters of the form's generated function
// module, e.g. IS_HEADER TYPE ZPO_S_HEADER, IT_ITEMS TYPE ZPO_T_ITEM. Stored as src/<name>.sfpi.json
//   { "description": "…", "parameters": [{ "name": "IS_HEADER", "type": "ZPO_S_HEADER" }, { "name": "IT_ITEMS", "type": "ZPO_T_ITEM" }] }
// and named by the form object (.form.json "interface"). From it: the Data View of the XDP designer (an XML schema in
// SAP's shape: a table's rows are DATA), sample data for the preview, the signature of the generated function
// module and a starter layout.
import fs from 'node:fs';
import path from 'node:path';

// "IS_HEADER TYPE ZPO_S_HEADER" / "IT_ITEMS TYPE TABLE OF ZPO_S_ITEM" / "IV_TITLE STRING" per line
export function parseParams(text) {
  const out = [];
  for (const raw of String(text || '').split('\n')) {
    const l = raw.trim().replace(/[.,;]$/, '');
    if (!l) continue;
    const m = /^([\w/]+)\s+(?:(type|like)\s+)?(?:(standard\s+table\s+of|table\s+of)\s+)?([\w/]+(?:\(\d+\))?)(\s+optional)?$/i.exec(l);
    if (!m) throw Object.assign(new Error(`"${l}": a parameter is "NAME TYPE type" (or TYPE TABLE OF a structure)`), { status: 400 });
    out.push({ name: m[1].toUpperCase(), type: m[4].toUpperCase(), ...(m[3] ? { table: true } : {}), ...(m[5] ? { optional: true } : {}) });
  }
  return out;
}

export function loadInterface(dir, name) {
  if (!name) return null;
  const f = path.join(dir, 'src', `${String(name).toLowerCase()}.sfpi.json`);
  if (!fs.existsSync(f)) return null;
  try { return { name: String(name).toUpperCase(), ...JSON.parse(fs.readFileSync(f, 'utf8')) }; } catch (e) { throw Object.assign(new Error(`Form interface ${name}: ${e.message}`), { status: 400 }); }
}

// the parameters with their shape, from the app's model: struct (components), table (components of a row), elem
export function resolveParams(params, model) {
  // the caption of a component: its data element's medium label, else its label annotation
  const caption = f => { const d = f.ti?.de && model?.ddic?.dataElements.get(f.ti.de); return d?.labels?.medium || d?.labels?.long || f.ann?.endusertext?.label || undefined; };
  const fieldsOf0 = n => model?.structures?.get(n)?.fields || model?.tables?.get(n)?.fields || null;
  const fieldsOf = n => fieldsOf0(n)?.map(f => ({ ...f, caption: caption(f) }));
  return (params || []).map(p => {
    const t = String(p.type || '').toLowerCase();
    const ttyp = model?.ddic?.tableTypes.get(t);
    const line = p.table ? t : ttyp?.rowtype || null;
    if (line) return { name: p.name, type: p.type, shape: 'table', line, fields: (fieldsOf(line) || [{ name: 'table_line', ti: { t: 'c' } }]).map(f => ({ name: f.name.toUpperCase(), ti: f.ti, caption: f.caption })) };
    const comps = fieldsOf(t);
    if (comps) return { name: p.name, type: p.type, shape: 'struct', fields: comps.map(f => ({ name: f.name.toUpperCase(), ti: f.ti, caption: f.caption })) };
    return { name: p.name, type: p.type, shape: 'elem', ti: elemTi(t, model) };
  });
}
function elemTi(t, model) {
  if (/^(i|int4|int8|int2|int1)$/.test(t)) return { t: 'i' };
  if (/^(p|dec|curr|quan)/.test(t)) return { t: 'p', dec: 2 };
  if (/^(d|dats|datum|sy-datum)$/.test(t)) return { t: 'd' };
  void model;
  return { t: 'c' };
}

const xsdType = ti => (ti?.t === 'd' ? 'xs:date' : ti?.t === 't' ? 'xs:time' : ti?.t === 'p' || ti?.t === 'f' ? 'xs:decimal' : ti?.t === 'i' || ti?.t === 'int8' ? 'xs:integer' : 'xs:string');
const el = (n, ti) => `<xs:element name="${n}" type="${xsdType(ti)}" minOccurs="0"/>`;
// the XML schema of the interface (the Data View, Download Schema)
export function interfaceXsd(resolved) {
  const part = p => {
    if (p.shape === 'elem') return el(p.name, p.ti);
    const comps = `<xs:sequence>${p.fields.map(f => el(f.name, f.ti)).join('')}</xs:sequence>`;
    if (p.shape === 'struct') return `<xs:element name="${p.name}" minOccurs="0"><xs:complexType>${comps}</xs:complexType></xs:element>`;
    return `<xs:element name="${p.name}" minOccurs="0"><xs:complexType><xs:sequence><xs:element name="DATA" minOccurs="0" maxOccurs="unbounded"><xs:complexType>${comps}</xs:complexType></xs:element></xs:sequence></xs:complexType></xs:element>`;
  };
  return `<?xml version="1.0" encoding="utf-8"?>\n<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema"><xs:element name="data"><xs:complexType><xs:sequence>${resolved.map(part).join('')}</xs:sequence></xs:complexType></xs:element></xs:schema>\n`;
}

// sample data for the preview (a form's "sample" in its .form.json wins)
export function interfaceSample(resolved) {
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const val = (f, i = 0) => {
    const t = f.ti?.t;
    if (t === 'd') return today;
    if (t === 't') return '120000';
    if (t === 'p' || t === 'f') return (i + 1) * 100 + 0.5;
    if (t === 'i' || t === 'int8') return (i + 1) * 10;
    if (t === 'n') return String((i + 1) * 10).padStart(Math.min(f.ti?.len || 5, 10), '0');
    if (/waers|cuky|curr/i.test(f.name)) return 'EUR';
    if (/meins|unit/i.test(f.name)) return 'PC';
    return `${f.name}${i ? ` ${i + 1}` : ''}`.slice(0, Math.max(4, f.ti?.len || 40));
  };
  const out = {};
  for (const p of resolved) {
    if (p.shape === 'elem') out[p.name] = val({ name: p.name, ti: p.ti });
    else if (p.shape === 'struct') out[p.name] = Object.fromEntries(p.fields.map(f => [f.name, val(f)]));
    else out[p.name] = [0, 1].map(i => Object.fromEntries(p.fields.map(f => [f.name, val(f, i)])));
  }
  return out;
}

// the generated function module's interface (what the driver program passes)
export function signature(formName, resolved) {
  return `CALL FUNCTION lv_fm_name   " FP_FUNCTION_MODULE_NAME( i_name = '${String(formName).toUpperCase()}' )\n  EXPORTING\n    /1bcdwb/docparams  = ls_docparams\n${resolved.map(p => `    ${p.name.toLowerCase().padEnd(18)} = ${p.shape === 'table' ? 'lt' : p.shape === 'struct' ? 'ls' : 'lv'}_${p.name.toLowerCase().replace(/^[a-z]{2}_/, '')}   " ${p.type}`).join('\n')}\n  IMPORTING\n    /1bcdwb/formoutput = ls_formoutput\n  EXCEPTIONS\n    OTHERS             = 1.`;
}

// ---------------------------------------------------------------- global data and initialization (classic engine)
// "global": [{ "name": "GV_TOTAL", "type": "ZPO_NETWR" }, { "name": "GT_LINES", "type": "ZPO_S_ITEM", "table": true }],
// "init": "ABAP code that fills the global data from the import parameters". The classic engine runs it in a
// function module generated per interface (ZFPIF_<interface>) before the layout is rendered; its result (the global
// data as JSON) joins the import parameters, so the layout binds $.GV_TOTAL like a parameter.
export const initFunctionName = itf => `ZFPIF_${String(itf).toUpperCase()}`.replace(/[^A-Z0-9_]/g, '_').slice(0, 30);
export const hasInit = itf => !!(itf?.global?.length || String(itf?.init || '').trim());
// shape(type, table) -> { kind: 'struct' | 'table' | 'elem', fields: [names] } from the app's dictionary
export function initFunctionSource(name, itf, shape) {
  const fm = initFunctionName(name).toLowerCase();
  const typ = p => (p.table ? `TABLES` : `TYPE`);
  const imp = (itf.parameters || []).filter(p => !p.table), tabs = (itf.parameters || []).filter(p => p.table);
  const head = [`FUNCTION ${fm}.`, '*"----------------------------------------------------------------------', '*"*"Local Interface:'];
  if (imp.length) head.push('*"  IMPORTING', ...imp.map(p => `*"     VALUE(${p.name.toUpperCase()}) TYPE  ${p.type.toUpperCase()} OPTIONAL`));
  head.push('*"  EXPORTING', '*"     VALUE(EV_JSON) TYPE  STRING');
  if (tabs.length) head.push('*"  TABLES', ...tabs.map(p => `*"      ${p.name.toUpperCase()} STRUCTURE  ${p.type.toUpperCase()} OPTIONAL`));
  head.push('*"----------------------------------------------------------------------');
  void typ;
  const decl = (itf.global || []).map(g => `  DATA ${g.name.toLowerCase()} TYPE ${g.table ? `STANDARD TABLE OF ${g.type.toLowerCase()} WITH EMPTY KEY` : g.type.toLowerCase()}.`);
  const str = v => `replace( val = |{ ${v} }| sub = '"' with = '\\"' occ = 0 )`;
  const ser = [];
  for (const g of itf.global || []) {
    const n = g.name.toLowerCase(), N = g.name.toUpperCase();
    const sh = shape(g.type, g.table);
    if (sh.kind === 'elem') { ser.push(`  ev_json = ev_json && \`"${N}":"\` && ${str(n)} && \`",\`.`); continue; }
    const obj = v => [`\`{\``, ...sh.fields.map(f => `\`"${f.toUpperCase()}":"\` && ${str(`${v}-${f.toLowerCase()}`)} && \`",\``), '`},`'].join(' && ');
    if (sh.kind === 'struct') { ser.push(`  ev_json = ev_json && \`"${N}":\` && ${obj(n)}.`); continue; }
    ser.push(`  ev_json = ev_json && \`"${N}":[\`.`, `  LOOP AT ${n} INTO DATA(ls_${n.slice(0, 24)}).`, `    ev_json = ev_json && ${obj(`ls_${n.slice(0, 24)}`)}.`, '  ENDLOOP.', '  ev_json = ev_json && `],`.');
  }
  return `${head.join('\n')}
${decl.join('\n')}
* initialization of the form interface
${String(itf.init || '').split('\n').map(l => `  ${l}`).join('\n')}
* the global data for the layout
  ev_json = \`{\`.
${ser.join('\n')}
  ev_json = ev_json && \`}\`.
  REPLACE ALL OCCURRENCES OF \`,}\` IN ev_json WITH \`}\`.
  REPLACE ALL OCCURRENCES OF \`,]\` IN ev_json WITH \`]\`.
ENDFUNCTION.
`;
}

// the interface's data as Adobe Document Services gets it: dates YYYY-MM-DD, times HH:MM:SS, initial ones empty
// (an initial date prints blank, never 00000000); by the types of the resolved parameters (resolveParams)
export function adsData(data, resolved) {
  const conv = (v, ti) => {
    if (ti?.t === 'd') { const m = /^(\d{4})-?(\d{2})-?(\d{2})$/.exec(String(v ?? '').trim()); return m && !/^0+$/.test(m.slice(1).join('')) ? `${m[1]}-${m[2]}-${m[3]}` : m || !String(v ?? '').trim() ? '' : v; }
    if (ti?.t === 't') { const m = /^(\d{2}):?(\d{2}):?(\d{2})$/.exec(String(v ?? '').trim()); return m && !/^0+$/.test(m.slice(1).join('')) ? `${m[1]}:${m[2]}:${m[3]}` : m || !String(v ?? '').trim() ? '' : v; }
    return v;
  };
  const get = (o, n) => Object.keys(o || {}).find(k => k.toUpperCase() === n);
  const row = (r, fields) => { if (!r || typeof r !== 'object') return r; const out = { ...r }; for (const f of fields || []) { const k = get(r, f.name); if (k) out[k] = conv(r[k], f.ti); } return out; };
  const out = { ...data };
  for (const p of resolved || []) {
    const k = get(data, p.name);
    if (!k) continue;
    if (p.shape === 'table' && Array.isArray(data[k])) out[k] = data[k].map(r => row(r, p.fields));
    else if (p.shape === 'struct') out[k] = row(data[k], p.fields);
    else if (p.shape === 'elem') out[k] = conv(data[k], p.ti);
  }
  return out;
}
