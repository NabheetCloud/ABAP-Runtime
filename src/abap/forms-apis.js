// SAP's form output APIs on the ABAP runtime, rendered by the form engine (src/forms/engine.js):
//  - ABAP Cloud (SAP Forms Service by Adobe): CL_FP_FORM_READER (a form: its layout and data provider),
//    CL_FP_FDP_SERVICES (a form data provider = a service definition; its leading entity's keys, the data with the
//    child entities as XML), CL_FP_ADS_UTIL=>RENDER_PDF (layout + XML data + locale -> PDF), CL_PRINT_QUEUE_UTILS
//  - classic (Interactive Forms by Adobe): FP_JOB_OPEN, FP_FUNCTION_MODULE_NAME, the generated function module
//    /1BCDWB/SM<form> (its interface parameters are the form's data; /1BCDWB/DOCPARAMS, /1BCDWB/FORMOUTPUT), FP_JOB_CLOSE
//  - interactive forms and signatures: CL_FP=>GET_REFERENCE( )->CREATE_PDF_OBJECT( ) with SET_DOCUMENT,
//    SET_EXTRACTDATA (the values of the fillable fields as XML: GET_DATA), SET_SIGNATURE (signs a signature field
//    with a key of the app's .rap/signing folder: GET_DOCUMENT), EXECUTE
//  - ZCL_RAP_FORM=>RENDER / PRINT / READ_FIELDS / SIGN (the short forms; PDF/A and passwords: IV_PDFA, IV_PASSWORD,
//    IV_OWNER_PASSWORD, IV_PERMISSIONS)
// A form is src/<name>.form.json (a RAP Studio layout) or an Adobe XDP layout src/<name>.xdp (rendered natively, as
// Adobe Document Services does: src/forms/xfa); the FDP's XML has SAP's shape (<Form><Alias>…, element names as in
// the CDS view, to-one associations nested, to-many ones wrapping their rows), so XDP templates designed against
// SAP's schema (GET_XSD) bind as on SAP BTP. Printed forms go to the output queue rap_output.
import { renderForm, formStore } from '../forms/engine.js';
import path from 'node:path';
import { renderXdp } from '../forms/xfa/render.js';
import { readFields, nest } from '../forms/pdfread.js';
import { loadInterface, resolveParams, adsData } from '../forms/interface.js';
import { signField, signingKey, verifyPdf } from '../forms/sign.js';
import { insertOutput, mergePdfs, toPdl, queueFormat, detectFormat, pageCount } from '../classic/printq.mjs';

const xmlEsc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
// data -> the FDP's XML: fields as elements, to-many children as <name table="X"><item>…</item></name>
export function toXml(name, data) {
  const node = (n, v) => {
    if (Array.isArray(v)) return `<${n} table="X">${v.map(r => node('item', r)).join('')}</${n}>`;
    if (v && typeof v === 'object') return `<${n}>${Object.entries(v).filter(([k]) => !k.startsWith('$') && !k.startsWith('%')).map(([k, x]) => node(k.toUpperCase(), x)).join('')}</${n}>`;
    return `<${n}>${xmlEsc(v)}</${n}>`;
  };
  return `<?xml version="1.0" encoding="UTF-8"?><Form version="2">${node(name.toUpperCase(), data)}</Form>`;
}
export function fromXml(xml) {
  const s = String(xml);
  let i = 0;
  const unesc = t => t.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
  const parse = () => {   // at '<name ...>': returns [name, value]
    const m = /^<([\w:/.-]+)([^>]*?)(\/?)>/.exec(s.slice(i));
    i += m[0].length;
    if (m[3]) return [m[1], ''];
    const table = /\btable="X"/.test(m[2]);
    const kids = [];
    let text = '';
    for (;;) {
      const lt = s.indexOf('<', i);
      text += s.slice(i, lt); i = lt;
      if (s.startsWith('</', i)) { i = s.indexOf('>', i) + 1; break; }
      if (s.startsWith('<!--', i)) { i = s.indexOf('-->', i) + 3; continue; }
      kids.push(parse());
    }
    if (table) return [m[1], kids.map(([, v]) => v)];
    // SAP's FDP XML: a to-many association (_Item) wraps one element per row
    if (/^_/.test(m[1]) && kids.length && kids.every(([k, v]) => k === kids[0][0] && v && typeof v === 'object')) return [m[1], kids.map(([, v]) => v)];
    if (!kids.length) return [m[1], unesc(text.trim())];
    const o = {};
    for (const [k, v] of kids) { const key = k.toLowerCase(); if (key in o) { if (!Array.isArray(o[key]) || !o[key].$rep) { o[key] = Object.assign([o[key]], { $rep: true }); } o[key].push(v); } else o[key] = v; }
    return [m[1], o];
  };
  i = s.indexOf('<Form');
  if (i < 0) i = s.search(/<[\w]/);
  if (i < 0) return {};
  const [, root] = parse();
  return root;
}
// the PDF data of an XML: the root entity's fields at the top (and under its name)
export function dataOfXml(xml) {
  const form = fromXml(xml);
  const keys = Object.keys(form || {});
  // (the root's own fields win over its name: an entity BillingDoc with a field BillingDoc)
  if (keys.length === 1 && form[keys[0]] && typeof form[keys[0]] === 'object' && !Array.isArray(form[keys[0]])) return { [keys[0]]: form[keys[0]], ...form[keys[0]] };
  return form;
}
const langLocale = (langu, country) => {
  const l = { E: 'en', D: 'de', F: 'fr', S: 'es', I: 'it', J: 'ja', 1: 'zh', H: 'hi', P: 'pt', N: 'nl' }[String(langu || 'E').trim().toUpperCase()] || String(langu || 'en').toLowerCase().slice(0, 2);
  return `${l}_${String(country || { en: 'US', de: 'DE', fr: 'FR', es: 'ES', it: 'IT', ja: 'JP', zh: 'CN', hi: 'IN', pt: 'BR', nl: 'NL' }[l] || 'US').trim().toUpperCase()}`;
};

// ---- SAP's form data provider XML: <Form><Alias><Element>…, values as Adobe Document Services gets them (dates
// YYYY-MM-DD, times HH:MM:SS, booleans true / false, binary data base64), to-one associations as nested elements,
// to-many associations wrapping one element per row (named by the target's exposure alias)
// an association's element name: the name the view exposes it under (_schedule as Schedule -> Schedule)
export const assocName = (ent, a) => [...(ent?.exposedAssocs || []), ...(ent?.fields || []).filter(f => f.isAssoc)].find(f => String(f.assocRef || '').toLowerCase() === String(a.name).toLowerCase())?.label || a.label || a.name;
const isBool = f => f?.ti?.t === 'bool' || /abap_bool|xsdboolean/i.test(f?.ti?.rollname || f?.rollname || f?.dtel || '');
function fdpValue(f, v) {
  if (v === null || v === undefined) return '';
  const t = f?.ti?.t;
  if (isBool(f)) return String(v).trim().toUpperCase() === 'X' ? 'true' : 'false';
  if (t === 'd') { const m = /^(\d{4})-?(\d{2})-?(\d{2})$/.exec(String(v)); return m && m[1] !== '0000' ? `${m[1]}-${m[2]}-${m[3]}` : ''; }
  if (t === 't') { const m = /^(\d{2}):?(\d{2}):?(\d{2})$/.exec(String(v)); return m ? `${m[1]}:${m[2]}:${m[3]}` : String(v); }
  if (Buffer.isBuffer(v) || v instanceof Uint8Array) return Buffer.from(v).toString('base64');
  if ((t === 'rawstring' || t === 'xstring' || t === 'string' && /^[0-9A-F]{40,}$/.test(String(v))) && /^([0-9A-F]{2})+$/i.test(String(v))) return Buffer.from(String(v), 'hex').toString('base64');
  return String(v);
}
export function fdpXml(alias, data) {
  const node = (name, d) => {
    const ent = d.$ent;
    let x = `<${name}>`;
    for (const [k, v] of Object.entries(d)) {
      if (k.startsWith('$')) continue;
      if (Array.isArray(v)) x += `<${k}>${v.map(r => node(v.$row || 'DATA', r)).join('')}</${k}>`;
      else if (v && typeof v === 'object' && !Buffer.isBuffer(v) && !(v instanceof Uint8Array)) x += node(k, v);
      else if (v === null && ent?.assocs && [...ent.assocs.values()].some(a => (a.label || a.name) === k)) x += `<${k}/>`;
      else { const f = ent?.fields.find(ff => (ff.label || ff.name) === k); x += `<${k}>${xmlEsc(fdpValue(f, v))}</${k}>`; }
    }
    return `${x}</${name}>`;
  };
  return `<?xml version="1.0" encoding="UTF-8"?><Form>${node(alias, data)}</Form>`;
}
const XSD_TYPE = f => (isBool(f) ? 'boolean' : ({ d: 'date', t: 'time', p: 'decimal', i: 'int', int8: 'long', f: 'double', decfloat16: 'decimal', decfloat34: 'decimal' })[f?.ti?.t] || 'string');
// the XML schema of an FDP (as ADT's Download Schema: a data connection for Adobe LiveCycle Designer)
export function fdpXsd(srv, root, model) {
  const types = new Map();
  const typeOf = (entName, alias, depth) => {
    const ent = model.entities.get(entName);
    if (!ent) return;
    const name = alias || ent.label || entName;
    if (types.has(name)) return name;
    types.set(name, '');
    let seq = '';
    for (const f of ent.fields) {
      if (f.isAssoc) continue;
      const t = XSD_TYPE(f), len = f.ti?.len && t === 'string' ? `<simpleType><restriction base="string"><maxLength value="${f.ti.len}"/></restriction></simpleType>` : '';
      seq += len ? `<element name="${f.label || f.name}" minOccurs="0">${len}</element>` : `<element name="${f.label || f.name}" type="${t}" minOccurs="0"/>`;
    }
    if (depth < 3) for (const a of ent.assocs?.values() || []) {
      if (a.toParent || !srv.exposes.some(e => e.entity === a.target)) continue;
      const ta = srv.exposes.find(e => e.entity === a.target).alias;
      const tn = typeOf(a.target, ta, depth + 1);
      if (!tn) continue;
      const an = assocName(ent, a);
      seq += a.card?.max !== 1 ? `<element name="${an}" minOccurs="0"><complexType><sequence><element name="${ta}" type="${tn}" minOccurs="0" maxOccurs="unbounded"/></sequence></complexType></element>` : `<element name="${an}" type="${tn}" minOccurs="0" maxOccurs="1"/>`;
    }
    types.set(name, `<complexType name="${name}"><sequence>${seq}</sequence></complexType>`);
    return name;
  };
  const top = typeOf(root.entity, root.alias, 0);
  return `<?xml version="1.0" encoding="utf-8"?>\n<schema version="2" xmlns="http://www.w3.org/2001/XMLSchema" xmlns:xfadata="http://www.xfa.org/schema/xfa-data/1.0/"><element name="Form"><complexType><sequence><element name="${root.alias}" type="${top}"/></sequence></complexType></element>${[...types.values()].join('')}</schema>`;
}
const dataType = f => (isBool(f) ? 'ABAP_BOOL' : ({ c: 'CHAR', n: 'NUMC', d: 'DATS', t: 'TIMS', p: 'DEC', i: 'INT4', raw: 'RAW', string: 'STRING', rawstring: 'RAWSTRING' })[f?.ti?.t] || 'CHAR');
// the classic interface's data as XML (Interactive Forms by Adobe): <data><PARAM>…, tables <ITAB><DATA>…</DATA></ITAB>
export function classicXml(data) {
  const node = (n, v) => {
    if (Array.isArray(v)) return `<${n}>${v.map(r => node('DATA', r)).join('')}</${n}>`;
    if (v && typeof v === 'object') return `<${n}>${Object.entries(v).filter(([k]) => !k.startsWith('$')).map(([k, x]) => node(k.toUpperCase(), x)).join('')}</${n}>`;
    return `<${n}>${xmlEsc(v)}</${n}>`;
  };
  return `<?xml version="1.0" encoding="UTF-8"?><data>${Object.entries(data).filter(([k]) => !k.startsWith('$')).map(([k, v]) => node(k.toUpperCase(), v)).join('')}</data>`;
}

export function installFormApis(rt, { def, AbapObject, cxStatic }) {
  const s = v => rt.s(v);
  const hex = b => Buffer.from(b).toString('hex').toUpperCase();
  const fromHexOrText = v => { const t = s(v); return /^([0-9A-Fa-f]{2})+$/.test(t) && t.length > 8 ? Buffer.from(t, 'hex').toString('utf8') : t; };
  const store = () => formStore(rt.appDir || process.cwd());
  const db = () => rt.sql?.rap?.db ?? rt.sql?.db;
  const sysData = () => ({ sy: { datum: s(rt.sy.datum), uzeit: s(rt.sy.uzeit), uname: s(rt.sy.uname || 'DEVELOPER'), sysid: 'RAP' } });
  const render = (form, data, locale, opts = {}) => renderForm(form, { ...sysData(), ...data }, { locale, assets: n => store().assets(n), ...opts });
  const key = name => {
    const k = signingKey(rt.appDir || process.cwd(), s(name) || 'default');
    if (!k) throw rt.new('cx_fp_runtime_usage', { text: `Signing key ${s(name).toUpperCase() || 'DEFAULT'} not found: create it with  rap form key ${s(name).toLowerCase() || 'default'}  (in the app's folder)` });
    return k;
  };
  const pdfOf = v => { const t = s(v); return Buffer.from(t, /^([0-9A-Fa-f]{2})+$/.test(t) ? 'hex' : 'latin1'); };
  // the output queue (also the classic engine's): printed forms, with the queue's name in the title
  // while a form processing job is open (FP_JOB_OPEN … FP_JOB_CLOSE) the forms are collected: the job is one output
  // request with their PDFs merged
  const queue = (form, title, r, extra = {}) => {
    const job = rt.$fpJob;
    if (job?.pdfs && !extra.direct) { job.pdfs.push({ form: String(form).toUpperCase(), title, pages: r.pages, pdf: r.pdf }); return 0; }
    const d = db();
    if (!d) throw rt.new('cx_fp_runtime_system', { text: 'Printing needs a database' });
    return insertOutput(d, { form, title, username: s(rt.sy.uname || 'DEVELOPER'), pages: r.pages, pdf: r.pdf, ...extra });
  };
  // the print data of the last rendered documents (render_4_pq): the PDF behind PostScript / ZPL for the preview
  const pdlSource = new Map();
  const loadForm = name => {
    const f = store().load(s(name));
    if (!f) throw rt.new('cx_fp_form_reader', { text: `Form ${s(name).toUpperCase()} does not exist (src/${s(name).toLowerCase()}.form.json)` });
    return f;
  };
  for (const n of ['cx_fp_form_reader', 'cx_fp_fdp_error', 'cx_fp_ads_util', 'cx_fp_runtime_internal', 'cx_fp_runtime_system', 'cx_fp_runtime_usage']) def(n, class extends cxStatic {});

  // ---- ABAP Cloud
  const Reader = def('cl_fp_form_reader', class extends AbapObject {
    static create_form_reader(p = {}) { const name = s(p.iv_formname ?? p.$0).trim(); const o = new Reader(); o.name = name; o.form = loadForm(name); return { $ret: o }; }
    // the layout: the XDP (Adobe) or the RAP Studio layout (JSON)
    get_layout() { return { $ret: hex(this.form.xdp || Buffer.from(JSON.stringify(this.form), 'utf8')) }; }
    get_fdp_name() { return { $ret: s(this.form.dataProvider || '').toUpperCase() }; }
    get_font_embed() { return { $ret: '' }; }
    get_form_name() { return { $ret: this.name.toUpperCase() }; }
  });
  // a form data provider: a service definition; its leading entity (@ObjectModel.leadingEntity or the first exposed)
  // with the children reached by its associations (compositions and exposed associations), three levels deep
  const Fdp = def('cl_fp_fdp_services', class extends AbapObject {
    static get_instance(p = {}) {
      const name = s(p.iv_service_definition ?? p.$0).trim().toLowerCase();
      const srv = rt.model?.services.get(name);
      if (!srv) throw rt.new('cx_fp_fdp_error', { text: `Service definition ${name.toUpperCase()} (form data provider) not found` });
      const lead = String(srv.ann?.objectmodel?.leadingentity?.name || '').toLowerCase();
      const root = srv.exposes.find(e => e.entity === lead || e.alias.toLowerCase() === lead) || srv.exposes[0];
      const o = new Fdp(); o.srv = srv; o.root = root;
      return { $ret: o };
    }
    // the leading entity's keys (name, value, data_type), like SAP: KEY names in upper case
    get_keys() {
      const ent = rt.model.entities.get(this.root.entity);
      return { $ret: (ent?.keys || []).map(k => { const f = ent.fields.find(x => x.name === k); return { name: String(f?.label || k).toUpperCase(), value: '', data_type: dataType(f) }; }) };
    }
    // the data: the leading entity's row (by its keys; it_select_add: further conditions such as IsActiveEntity)
    // with the children reached by its associations to exposed entities (and compositions), three levels deep
    read(keys, add = [], { shape = 'sap' } = {}) {
      const d = db(), model = rt.model, exposed = new Set(this.srv.exposes.map(e => e.entity));
      const aliasOf = ent => this.srv.exposes.find(e => e.entity === ent)?.alias;
      const rows = (ent, where) => {
        const cols = Object.keys(where);
        return d.prepare(`SELECT * FROM "${ent}"${cols.length ? ` WHERE ${cols.map(c => `"${c}" = ?`).join(' AND ')}` : ''}`).all(...cols.map(c => where[c]));
      };
      const expand = (entName, row, depth) => {
        const ent = model.entities.get(entName);
        const out = { $ent: ent };
        for (const f of ent?.fields || []) if (!f.isAssoc) out[f.label || f.name] = row[f.name] ?? row[String(f.name).toLowerCase()];
        if (!ent) Object.assign(out, row);
        if (depth > 2 || !ent?.assocs) return out;
        for (const a of ent.assocs.values()) {
          if (a.toParent || !(a.composition || (a.exposed && exposed.has(a.target)) || exposed.has(a.target))) continue;
          const where = Object.fromEntries((a.pairs || []).map(([src, tgt]) => [tgt, row[src]]));
          if (!Object.keys(where).length) continue;
          let kids;
          try { kids = rows(a.target, where).map(r => expand(a.target, r, depth + 1)); } catch { continue; }
          const many = a.card?.max !== 1;
          out[assocName(ent, a)] = many ? Object.assign(kids, { $row: aliasOf(a.target) || String(a.target) }) : kids[0] || null;
        }
        return out;
      };
      const ent = model.entities.get(this.root.entity);
      const col = n => { const f = ent?.fields.find(x => String(x.label || x.name).toLowerCase() === String(n).toLowerCase() || x.name === String(n).toLowerCase()); return f?.name; };
      const where = {};
      for (const k of [...(keys || []), ...(add || [])]) {
        const c = col(s(k.name)); let v = s(k.value);
        if (!c || v === '') continue;
        const f = ent.fields.find(x => x.name === c);
        if (/^(x|true)$/i.test(v) && /abap_bool/i.test(f?.ti?.rollname || f?.rollname || '')) v = 'X';
        if (f?.ti?.t === 'raw' || /uuid/i.test(f?.ti?.rollname || '')) v = v.replace(/-/g, '').toUpperCase();
        where[c] = v;
      }
      if (ent?.def?.draft && !('isactiveentity' in where)) { /* drafts: active data */ }
      let found;
      try { found = rows(this.root.entity, where); } catch (e) { throw rt.new('cx_fp_fdp_error', { text: e.message }); }
      if (!found.length) throw rt.new('cx_fp_fdp_error', { text: `No ${this.root.alias} for the keys ${JSON.stringify(where)}` });
      const data = expand(this.root.entity, found[0], 0);
      return shape === 'data' ? data : fdpXml(this.root.alias, data);
    }
    read_to_xml(p = {}) { return { $ret: hex(Buffer.from(this.read(p.it_select ?? p.$0, p.it_select_add), 'utf8')) }; }
    read_to_xml_v2(p = {}) { return { $ret: hex(Buffer.from(this.read(p.it_select ?? p.$0, p.it_select_add), 'utf8')) }; }
    // the XML schema of the data (Download Schema in ADT: the data connection of an Adobe LiveCycle Designer layout)
    get_xsd() { return { $ret: hex(Buffer.from(fdpXsd(this.srv, this.root, rt.model), 'utf8')) }; }
  });
  // the data of a record of a form data provider (the studio's preview): { root fields, children }
  rt.formRead = (srvd, keys) => dataOfXml(Fdp.get_instance({ iv_service_definition: srvd }).$ret.read(keys));
  // the FDP's XML of a record (the studio's preview of XDP layouts)
  rt.formXml = (srvd, keys) => Fdp.get_instance({ iv_service_definition: srvd }).$ret.read(keys);
  rt.formXsd = srvd => { const f = Fdp.get_instance({ iv_service_definition: srvd }).$ret; return fdpXsd(f.srv, f.root, rt.model); };
  // render: an XDP layout natively (XFA), a RAP Studio layout with the form engine
  const adsRender = (p, { pq } = {}) => {
    const layout = fromHexOrText(p.iv_xdp_layout);
    const locale = s(p.iv_locale || '').trim() || 'en_US';
    const xml = fromHexOrText(p.iv_xml_data);
    const trace = rt.n(p.is_options?.trace_level || 0);
    try {
      if (/^\s*</.test(layout)) {
        const st = store();
        // is_options-pdfa / pdf_a = 'X': PDF/A-2b; fillable = 'X': an interactive form
        const opt = k => s(p.is_options?.[k] ?? '').trim();
        const r = renderXdp(layout, xml, { locale, fontDirs: st.fontDirs(), assetDir: path.join(rt.appDir || process.cwd(), 'src'),
          ...(/^[XA]/i.test(opt('pdfa') || opt('pdf_a')) ? { pdfa: true } : {}), ...(opt('fillable') === 'X' ? { interactive: true } : {}) });
        return { r, traceText: trace ? [`Rendered ${r.pages} page(s), ${r.pdf.length} bytes (XFA)`, ...r.warnings.map(w => `Warning: ${w}`)].join('\n') : '' };
      }
      let form;
      try { form = JSON.parse(layout); } catch { throw new Error('The layout is neither an XDP (Adobe XFA) nor a RAP Studio form'); }
      const r = render(form, dataOfXml(xml), s(p.iv_locale || form.locale || 'en_US'));
      return { r, traceText: trace ? [`Rendered ${r.pages} page(s), ${r.pdf.length} bytes`, ...r.warnings.map(w => `Warning: ${w}`)].join('\n') : '' };
    } catch (e) { throw rt.new('cx_fp_ads_util', { text: e.message }); }
  };
  def('cl_fp_ads_util', class extends AbapObject {
    // render_pdf( iv_xdp_layout iv_xml_data iv_locale is_options ) -> ev_pdf ev_pages ev_trace_string
    static render_pdf(p = {}) {
      const { r, traceText } = adsRender(p);
      return { $ret: '', ev_pdf: hex(r.pdf), ev_pages: r.pages, ev_trace_string: traceText };
    }
    // render_4_pq( iv_pq_name iv_xdp_layout iv_xml_data iv_locale is_options ) -> ev_pdl (the print data for the
    // print queue: PDF), ev_pages, ev_trace_string
    // the printer language: is_options-pdl ('PDF', 'PS', 'ZPL'), else the print queue's (rap_print_queue), else PDF
    static render_4_pq(p = {}) {
      const { r, traceText } = adsRender(p, { pq: true });
      const want = s(p.is_options?.pdl || '').trim() || (db() ? queueFormat(db(), s(p.iv_pq_name || '').trim()) : null) || 'PDF';
      const out = toPdl(r.pdf, want);
      const pdl = hex(out.data);
      if (out.format !== 'PDF') { pdlSource.set(pdl.slice(0, 256) + pdl.length, r.pdf); if (pdlSource.size > 20) pdlSource.delete(pdlSource.keys().next().value); }
      const trace = [traceText, out.warning ? `Warning: ${out.warning}` : '', rt.n(p.is_options?.trace_level || 0) ? `Print data: ${out.format}, ${out.data.length} bytes` : ''].filter(Boolean).join('\n');
      return { $ret: '', ev_pdl: pdl, ev_pages: r.pages, ev_trace_string: trace };
    }
  });
  def('cl_print_queue_utils', class extends AbapObject {
    // create_queue_item_by_data( iv_qname iv_print_data iv_name_of_main_doc [iv_number_of_copies] ) -> rv_itemid
    // print data in any printer language (PDF, PostScript, ZPL); the queue item keeps the PDF for the preview
    static create_queue_item_by_data(p = {}) {
      const hexData = s(p.iv_print_data);
      const data = Buffer.from(hexData, 'hex');
      const format = detectFormat(data);
      const pdf = format === 'PDF' ? data : pdlSource.get(hexData.slice(0, 256) + hexData.length) || null;
      const qname = s(p.iv_qname || 'DEFAULT').trim() || 'DEFAULT';
      const id = queue(s(p.iv_name_of_main_doc || 'DOCUMENT'), `${qname}: ${s(p.iv_name_of_main_doc || 'document')}`, { pdf, pages: pdf ? pageCount(pdf) : 0 },
        { direct: true, qname, copies: rt.n(p.iv_number_of_copies || 1) || 1, format: format === 'BIN' ? 'PDF' : format, pdl: format === 'PDF' ? null : data });
      return { $ret: String(id), ev_err_msg: '' };
    }
  });

  // ---- classic: FP_JOB_OPEN, FP_FUNCTION_MODULE_NAME, /1BCDWB/SM<form>, FP_JOB_CLOSE (via CALL FUNCTION)
  rt.formFunction = (fm, args) => {
    switch (fm) {
      case 'FP_JOB_OPEN': rt.$fpJob = { params: { ...(args.ie_outputparams || {}) }, outputs: [], pdfs: [] }; return { ie_outputparams: args.ie_outputparams };
      case 'FP_FUNCTION_MODULE_NAME': {
        const name = s(args.i_name).trim();
        if (!store().exists(name)) throw rt.classicException('usage_error');
        return { e_funcname: `/1BCDWB/SM_${name.toUpperCase()}`, e_interface_type: 'S' };
      }
      // the job's forms: one output request (dest: the print queue, covtitle: the title, copies), e_result-spoolids
      case 'FP_JOB_CLOSE': {
        const job = rt.$fpJob;
        rt.$fpJob = null;
        const ids = [];
        if (job?.pdfs?.length) {
          const op = job.params || {};
          const extra = { direct: true, qname: s(op.dest || '').trim() || 'DEFAULT', copies: rt.n(op.copies || 1) || 1,
            options: Object.fromEntries(['nodialog', 'preview', 'reqimm', 'reqnew', 'reqdel', 'dest', 'pdftype'].map(k => [k, s(op[k] || '').trim()]).filter(([, v]) => v)) };
          const title = s(op.covtitle || '').trim() || job.pdfs[0].title;
          let merged = null;
          try { merged = mergePdfs(job.pdfs.map(o => o.pdf)); } catch { merged = null; }
          if (merged) ids.push(queue([...new Set(job.pdfs.map(o => o.form))].join(', '), title, { pages: job.pdfs.reduce((n, o) => n + o.pages, 0), pdf: merged }, extra));
          else for (const o of job.pdfs) ids.push(queue(o.form, title, o, extra));
        }
        return { e_result: { remaining_pages: 0, outputs: job?.outputs.length || 0, spoolids: ids.map(String) } };
      }
    }
    if (fm.startsWith('/1BCDWB/SM_')) {
      const job = rt.$fpJob;
      if (!job) throw rt.classicException('usage_error');   // FP_JOB_OPEN first
      const name = fm.slice('/1BCDWB/SM_'.length);
      const form = loadForm(name);
      const doc = args['/1bcdwb/docparams'] || {};
      // the form's interface: every parameter is data; a single structure also lends its components
      const data = Object.fromEntries(Object.entries(args).filter(([k]) => !k.startsWith('/1bcdwb/') && !k.startsWith('$')));
      const vals = Object.values(data);
      if (vals.length === 1 && vals[0] && typeof vals[0] === 'object' && !Array.isArray(vals[0])) Object.assign(data, vals[0]);
      // fillable = 'X': an interactive form (its input fields can be filled in); otherwise they are printed
      // outputparams-pdftype 'A' (PDF/A): an archivable PDF
      const loc = doc.langu || doc.country ? langLocale(doc.langu, doc.country) : form.locale;
      // the data by the form interface's types: dates and times as ADS gets them, initial ones empty
      let xdpData = data;
      if (form.xdp && form.interface && rt.model) {
        try { const itf = loadInterface(rt.appDir || process.cwd(), form.interface); if (itf) xdpData = adsData(data, resolveParams([...(itf.parameters || []), ...(itf.global || [])], rt.model)); } catch { xdpData = data; }
      }
      const r = form.xdp
        ? renderXdp(form.xdp, classicXml(xdpData), { locale: loc || 'en_US', fontDirs: store().fontDirs(), assetDir: path.join(rt.appDir || process.cwd(), 'src'), ...(s(doc.fillable) === 'X' ? { interactive: true } : {}), ...(/^a/i.test(s(job.params.pdftype)) ? { pdfa: true } : {}) })
        : render(form, data, loc, { fillable: s(doc.fillable) === 'X' ? true : form.interactive === true, ...(/^a/i.test(s(job.params.pdftype)) ? { pdfa: true } : {}) });
      if (s(job.params.getpdf) !== 'X') queue(name, s(job.params.title || form.title || name), r);   // print (spool): the output queue
      job.outputs.push(name);
      return { '/1bcdwb/formoutput': { pdf: hex(r.pdf), pages: r.pages } };
    }
    return null;
  };

  // ---- interactive forms: the PDF object of the form processing (cl_fp)
  const Fp = def('cl_fp', class extends AbapObject {
    static get_reference() { return { $ret: new Fp() } ; }
    create_pdf_object() { return { $ret: new PdfObject() }; }
  });
  const PdfObject = def('cl_fp_pdf_object', class extends AbapObject {
    set_document(p = {}) { this.pdf = pdfOf(p.pdfdata ?? p.$0); this.tasks = []; return {}; }
    set_extractdata() { (this.tasks ||= []).push({ task: 'extract' }); return {}; }
    set_task_extractdata() { return this.set_extractdata(); }
    set_signature(p = {}) { (this.tasks ||= []).push({ task: 'sign', key: s(p.keyname), field: s(p.fieldname), reason: s(p.reason), location: s(p.location), contact: s(p.contactinfo) }); return {}; }
    set_task_verifysignature() { (this.tasks ||= []).push({ task: 'verify' }); return {}; }
    execute() {
      if (!this.pdf) throw rt.new('cx_fp_runtime_usage', { text: 'No document: call set_document( ) first' });
      for (const t of this.tasks || []) {
        try {
          if (t.task === 'extract') this.data = nest(readFields(this.pdf));
          if (t.task === 'sign') this.pdf = signField(this.pdf, { field: t.field || undefined, reason: t.reason, location: t.location, contact: t.contact, name: s(rt.sy.uname || ''), ...key(t.key) });
          if (t.task === 'verify') this.signatures = verifyPdf(this.pdf);
        } catch (e) { if (e?.get_text) throw e; throw rt.new('cx_fp_runtime_usage', { text: e.message }); }
      }
      this.tasks = [];
      return {};
    }
    // the values of the fillable fields as XML: <data><FIELD>value</FIELD>…</data>
    get_data() { return { formdata: hex(Buffer.from(toXml('data', this.data || {}), 'utf8')) }; }
    get_document() { return { pdfdata: hex(this.pdf || Buffer.alloc(0)) }; }
    get_signature_status() { const v = this.signatures || verifyPdf(this.pdf || Buffer.alloc(0)); return { $ret: v.length ? (v.every(x => x.valid) ? 'V' : 'I') : '' }; }
  });

  // ---- ZCL_RAP_FORM: render( iv_form is_data ) -> PDF, print( iv_form is_data iv_title ) -> output request,
  // read_fields( iv_pdf ) -> name / value of the fillable fields, sign( iv_pdf iv_field iv_key iv_reason ) -> PDF
  // ZCL_RAP_FORM options of render / print: iv_pdfa = abap_true (PDF/A-2b), iv_password (to open), iv_owner_password and
  // iv_permissions ('print,fill,copy,…') (AES-256); iv_locale
  const formOptions = p => {
    const perms = s(p.iv_permissions).trim();
    const sec = s(p.iv_password) || s(p.iv_owner_password) || perms ? { userPassword: s(p.iv_password), ownerPassword: s(p.iv_owner_password) || undefined, permissions: perms ? perms.split(/[\s,;]+/).filter(Boolean) : undefined } : undefined;
    return { ...(s(p.iv_pdfa) === 'X' ? { pdfa: true } : {}), ...(sec ? { security: sec } : {}) };
  };
  // a form object with an XDP layout or a RAP Studio layout, with the options (PDF/A, passwords, fillable)
  const renderAny = (form, data, locale, opts) => (form.xdp
    ? renderXdp(form.xdp, classicXml(data || {}), { locale: locale || 'en_US', fontDirs: store().fontDirs(), assetDir: path.join(rt.appDir || process.cwd(), 'src'), ...(opts.pdfa ? { pdfa: true } : {}), ...(opts.security ? { security: opts.security } : {}) })
    : render(form, data, locale, opts));
  def('zcl_rap_form', class extends AbapObject {
    static read_fields(p = {}) { try { const f = readFields(pdfOf(p.iv_pdf ?? p.$0), { password: s(p.iv_password) }); rt.sy.subrc = 0; return { $ret: Object.entries(f).map(([name, value]) => ({ name, value })) }; } catch { rt.sy.subrc = 4; return { $ret: [] }; } }
    static sign(p = {}) { try { const r = signField(pdfOf(p.iv_pdf ?? p.$0), { field: s(p.iv_field) || undefined, reason: s(p.iv_reason), name: s(rt.sy.uname || ''), ...key(p.iv_key) }); rt.sy.subrc = 0; return { $ret: hex(r) }; } catch { rt.sy.subrc = 4; return { $ret: '' }; } }
    static render(p = {}) { try { const form = loadForm(p.iv_form); const r = renderAny(form, p.is_data || {}, s(p.iv_locale) || form.locale, formOptions(p)); rt.sy.subrc = 0; return { $ret: hex(r.pdf) }; } catch { rt.sy.subrc = 4; return { $ret: '' }; } }
    static print(p = {}) { try { const name = s(p.iv_form); const form = loadForm(name); const r = renderAny(form, p.is_data || {}, s(p.iv_locale) || form.locale, formOptions(p)); rt.sy.subrc = 0; return { $ret: queue(name, s(p.iv_title || form.title || name), r) }; } catch { rt.sy.subrc = 4; return { $ret: 0 }; } }
  });
}
