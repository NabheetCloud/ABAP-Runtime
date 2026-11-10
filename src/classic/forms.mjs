// Print forms of the classic engine, the open counterpart of SAP Interactive Forms by Adobe: a form is a
// declarative layout (src/<name>.form.json) filled with the data a program passes to zcl_rap_form=>render/print and
// rendered by the form engine of the ABAP runtime (src/forms/engine.js, where the layout is described): master pages,
// tables with repeated headers, groups and totals, conditions, text modules, images, barcodes, locale formats.
// Printed forms go to the output queue (table rap_output).
import fs from 'node:fs';
import path from 'node:path';
import { renderForm } from '../forms/engine.js';
import { renderXdp } from '../forms/xfa/render.js';
import { ensureOutputTable, insertOutput, mergePdfs } from './printq.mjs';
import { session } from './locks.mjs';

// ABAP data -> plain JavaScript (structures to objects, tables to arrays, dates as YYYYMMDD strings). xml: the data
// of an XDP (Adobe) form, as Adobe Document Services gets it: dates YYYY-MM-DD, times HH:MM:SS, initial ones empty
export function toJs(v, xml = false) {
  if (v === null || v === undefined) return v;
  if (typeof v !== 'object') return v;
  if (typeof v.getPointer === 'function' && v.constructor?.name === 'FieldSymbol') return toJs(v.getPointer(), xml);
  if (typeof v.array === 'function') return v.array().map(x => toJs(x, xml));
  const g = typeof v.get === 'function' ? v.get() : v;
  if (g && typeof g === 'object' && !Array.isArray(g) && !(typeof g.get === 'function')) {
    const out = {};
    for (const [k, x] of Object.entries(g)) out[k.toLowerCase()] = toJs(x, xml);
    return out;
  }
  if (xml && v.constructor?.name === 'Date') { const d = String(g ?? ''); return /^\d{8}$/.test(d) && !/^0+$/.test(d) ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}` : ''; }
  if (xml && v.constructor?.name === 'Time') { const t = String(g ?? ''); return /^\d{6}$/.test(t) && !/^0+$/.test(t) ? `${t.slice(0, 2)}:${t.slice(2, 4)}:${t.slice(4, 6)}` : ''; }
  return typeof g === 'string' ? g.replace(/ +$/, '') : g;
}
// the user's date format (their settings): forms printed by programs show dates as their lists do
import { userDate } from './userdate.mjs';

export function installForms(abap, client, { formsDir }) {
  const db = client.db;
  ensureOutputTable(db);
  const list = () => fs.existsSync(formsDir) ? [...new Set(fs.readdirSync(formsDir).filter(f => f.endsWith('.form.json') || f.endsWith('.xdp')).map(f => f.replace(/\.form\.json$|\.xdp$/, '').toUpperCase()))].sort() : [];
  // a layout (.form.json), or an Adobe XDP layout (src/<name>.xdp, or the form object's "layout")
  const load = name => {
    const base = String(name).trim().toLowerCase();
    const f = path.join(formsDir, `${base}.form.json`);
    const m = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null;
    const x = path.join(formsDir, m?.layout ? path.basename(m.layout).toLowerCase() : `${base}.xdp`);
    if ((m?.layout || !m) && fs.existsSync(x)) return { title: m?.title || base.toUpperCase(), dataProvider: m?.dataProvider, interface: m?.interface, locale: m?.locale, xdp: fs.readFileSync(x) };
    return m;
  };
  const sy = () => abap.builtin.sy.get();
  const sysData = () => { const s = sy(); const v = x => { try { return String(x?.get?.() ?? '').trim(); } catch { return ''; } }; return { sy: { datum: v(s.datum), uzeit: v(s.uzeit), uname: v(s.uname), sysid: v(s.sysid) } }; };
  // rendered by the form engine of the ABAP runtime (src/forms/engine.js): the same layouts, images and barcodes
  async function render(name, data, opts = {}) {
    const form = load(name);
    if (!form) throw new Error(`Form ${name} does not exist (src/${String(name).toLowerCase()}.form.json)`);
    const r = form.xdp
      ? renderXdp(form.xdp, data, { locale: opts.locale || form.locale, assetDir: formsDir, fontDirs: [formsDir], interactive: opts.interactive, userDateFormat: userDate.pattern })
      : renderForm(form, { ...sysData(), ...data }, { assets: n => { const p = path.join(formsDir, path.basename(n)); return fs.existsSync(p) ? fs.readFileSync(p) : null; } });
    return { form, pages: r.pages, pdf: r.pdf };
  }
  const isXdp = name => { try { return !!load(name)?.xdp; } catch { return false; } };
  const store = (name, title, r, extra = {}) => insertOutput(db, { form: name, title: title || r.form?.title || name, username: String(sy().uname?.get?.() ?? '').trim(), pages: r.pages, pdf: r.pdf, ...extra });

  const cls = abap.Classes.ZCL_RAP_FORM;
  if (cls) {
    cls.render = async ({ iv_form, is_data }) => {
      const out = new abap.types.XString();
      try { out.set((await render(toJs(iv_form), toJs(is_data, isXdp(toJs(iv_form))) || {})).pdf.toString('hex').toUpperCase()); sy().subrc.set(0); }
      catch (e) { console.error(`[classic] form: ${e.message}`); sy().subrc.set(4); }
      return out;
    };
    cls.print = async ({ iv_form, is_data, iv_title }) => {
      const out = new abap.types.Integer();
      try { const name = toJs(iv_form); out.set(store(name, toJs(iv_title), await render(name, toJs(is_data, isXdp(name)) || {}))); sy().subrc.set(0); }
      catch (e) { console.error(`[classic] form: ${e.message}`); sy().subrc.set(4); }
      return out;
    };
  }
  // SAP's form processing for driver programs: FP_JOB_OPEN, FP_FUNCTION_MODULE_NAME (the form's generated function
  // module /1BCDWB/SM…: its parameters are the form interface, rendered with the XDP or the layout), FP_JOB_CLOSE.
  // outputparams-getpdf = 'X' returns the PDF in /1BCDWB/FORMOUTPUT; otherwise the job is one output request: the
  // forms between FP_JOB_OPEN and FP_JOB_CLOSE are merged into one PDF (dest: the print queue, covtitle: the title,
  // copies; nodialog / preview / reqimm / reqnew are kept with the request) and FP_JOB_CLOSE returns its number in
  // e_result-spoolids.
  if (abap.FunctionModules) {
    const val = (s, k) => { try { return String(s?.get?.()[k]?.get?.() ?? '').trim(); } catch { return ''; } };
    const LOCALES = { E: 'en_US', D: 'de_DE', F: 'fr_FR', S: 'es_ES', I: 'it_IT', N: 'nl_NL', J: 'ja_JP', P: 'pt_PT' };
    let job = null;
    const names = new Map();
    abap.FunctionModules.FP_JOB_OPEN = async ({ changing = {} }) => {
      const op = changing.ie_outputparams;
      job = { getpdf: /X/i.test(val(op, 'getpdf')), title: val(op, 'covtitle'), pdfa: /^A/i.test(val(op, 'pdftype')), outputs: [],
        qname: val(op, 'dest') || 'DEFAULT', copies: Number(val(op, 'copies')) || 1,
        options: Object.fromEntries(['nodialog', 'preview', 'reqimm', 'reqnew', 'reqdel', 'dest', 'dataset', 'suffix1', 'suffix2', 'pdftype'].map(k => [k, val(op, k)]).filter(([, v]) => v)) };
      sy().subrc.set(0);
    };
    abap.FunctionModules.FP_FUNCTION_MODULE_NAME = async ({ exporting = {}, importing = {} }) => {
      const form = toJs(exporting.i_name).trim().toUpperCase();
      if (!names.has(form)) names.set(form, `/1BCDWB/SM${String(names.size + 1).padStart(8, '0')}`);
      const fm = names.get(form);
      abap.FunctionModules[fm] = async ({ exporting: ex = {}, importing: im = {} }) => {
        const data = {};
        let doc = null;
        const xml = isXdp(form);
        for (const [k, v] of Object.entries(ex)) { const n = k.replace(/^.*\//, ''); if (/docparams$/i.test(k)) doc = v; else data[n] = toJs(v, xml); }
        // the form interface's global data: its initialization runs in the function module ZFPIF_<interface>
        const itfName = load(form)?.interface;
        const initFm = itfName && abap.FunctionModules[`ZFPIF_${String(itfName).toUpperCase()}`.replace(/[^A-Z0-9_]/g, '_').slice(0, 30)];
        if (initFm) {
          try {
            const json = new abap.types.String();
            const tables = {}, exporting = {};
            let itf = {};
            try { itf = JSON.parse(fs.readFileSync(path.join(formsDir, `${String(itfName).toLowerCase()}.sfpi.json`), 'utf8')); } catch {}
            const isTables = n => (itf.parameters || []).some(p => p.table && p.name.toLowerCase() === n.toLowerCase());
            for (const [k, v] of Object.entries(ex)) { if (/docparams$/i.test(k)) continue; const n = k.replace(/^.*\//, ''); (isTables(n) ? tables : exporting)[n] = v; }
            await initFm({ exporting, importing: { ev_json: json }, tables });
            Object.assign(data, JSON.parse(String(json.get() || '{}')));
          } catch (e) { console.error(`[classic] form interface ${itfName}: initialization failed: ${e.message}`); }
        }
        const locale = LOCALES[val(doc, 'langu').toUpperCase()] ? `${LOCALES[val(doc, 'langu').toUpperCase()].slice(0, 3)}${val(doc, 'country') || LOCALES[val(doc, 'langu').toUpperCase()].slice(3)}` : undefined;
        const r = await render(form, data, { locale, interactive: /X/i.test(val(doc, 'fillable')) || undefined });
        if (job && !job.getpdf) job.outputs.push({ form, title: r.form.title, pages: r.pages, pdf: r.pdf });
        // getpdf = 'X': the program gets the PDF; the page of this dialog step offers it too (host.mjs, previews)
        else if (job?.getpdf) { const st = session.getStore(); if (st) (st.previews ||= []).push({ form, title: job.title || r.form.title, pages: r.pages, pdf: r.pdf }); }
        else if (!job) store(form, r.form.title, r);
        const out = Object.entries(im).find(([k]) => /formoutput$/i.test(k))?.[1];
        if (out) { const o = out.get(); o.pdf?.set(r.pdf.toString('hex').toUpperCase()); o.pages?.set(r.pages); }
        sy().subrc.set(0);
      };
      importing.e_funcname?.set(fm);
      sy().subrc.set(0);
    };
    abap.FunctionModules.FP_JOB_CLOSE = async ({ importing = {} } = {}) => {
      const j = job;
      job = null;
      const ids = [];
      if (j?.outputs.length) {
        const extra = { qname: j.qname, copies: j.copies, options: j.options };
        const title = j.title || j.outputs[0].title;
        const forms = [...new Set(j.outputs.map(o => o.form))].join(', ');
        let merged = null;
        try { merged = mergePdfs(j.outputs.map(o => o.pdf)); } catch (e) { console.error(`[classic] output: the forms of the job are kept apart (${e.message})`); }
        if (merged) ids.push(store(forms, title, { pages: j.outputs.reduce((n, o) => n + o.pages, 0), pdf: merged }, extra));
        else for (const o of j.outputs) ids.push(store(o.form, title, o, extra));
      }
      const res = importing.e_result?.get?.();
      if (res) {
        const tab = res.spoolids;
        for (const id of ids) { const row = typeof tab?.getRowType === 'function' ? tab.getRowType().clone() : null; if (row) { row.set(id); tab.append(row); } else tab?.append?.(id); }
        res.remaining_pages?.set?.(0);
      }
      sy().subrc.set(0);
    };
  }
  return {
    list, load, render, store,
    preview: async name => (await render(name, load(name)?.sample || {})).pdf,
    outputs: (limit = 100) => db.prepare('SELECT id, form, title, username, created, pages, length(pdf) AS bytes, qname, copies, format FROM rap_output ORDER BY id DESC LIMIT ?').all(limit),
    output: id => db.prepare('SELECT * FROM rap_output WHERE id = ?').get(id),
    remove: id => db.prepare('DELETE FROM rap_output WHERE id = ?').run(id).changes,
  };
}
