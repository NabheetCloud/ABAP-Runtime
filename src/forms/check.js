// The check of print form layouts (part of the activation and of `rap form check`): the JSON, the data provider,
// and a test rendering with the layout's sample data and the fields of its data provider, whose warnings (unknown
// fields, styles, fonts, images, items, expressions that fail) become findings with the layout's file.
import fs from 'node:fs';
import path from 'node:path';
import { renderForm, formStore } from './engine.js';
import { renderXdp } from './xfa/render.js';
import { assocName } from '../abap/forms-apis.js';

const KEYS = new Set(['layout', 'title', 'locale', 'dataProvider', 'page', 'fonts', 'font', 'variables', 'interactive', 'styles', 'texts', 'watermark', 'sample', 'firstHeader', 'header', 'footer', 'content', 'headerLine', 'description', 'pdfa', 'security']);

// a record of a data provider with every field (empty), its child entities as one line each: the shape of its data
export function fdpShape(model, srvd) {
  const srv = model?.services.get(String(srvd || '').toLowerCase());
  if (!srv) return null;
  const lead = String(srv.ann?.objectmodel?.leadingentity?.name || '').toLowerCase();
  const root = srv.exposes.find(e => e.entity === lead || e.alias.toLowerCase() === lead) || srv.exposes[0];
  const exposed = new Set(srv.exposes.map(e => e.entity));
  const shape = (name, depth) => {
    const ent = model.entities.get(name);
    const out = {};
    for (const f of ent?.fields || []) out[f.name.toLowerCase()] = '';
    if (depth < 3) for (const a of ent?.assocs?.values() || []) {
      if (a.toParent || !(a.composition || (a.exposed && exposed.has(a.target)))) continue;
      const child = shape(a.target, depth + 1);
      out[(a.label || a.name).toLowerCase()] = a.card?.max === 1 ? child : [child];
    }
    return out;
  };
  return root ? shape(root.entity, 0) : null;
}

// the line of a JSON syntax error: from "position N", "line N", or the excerpt that newer Node versions quote
function jsonErrorLine(text, msg) {
  const lineOf = pos => text.slice(0, pos).split('\n').length;
  const pos = /position (\d+)/.exec(msg);
  if (pos) return lineOf(Number(pos[1]));
  const ln = /line (\d+)/.exec(msg);
  if (ln) return Number(ln[1]);
  const ex = /"(?:\.\.\.)?([\s\S]*?)(?:\.\.\.)?" is not valid JSON/.exec(msg), tok = /Unexpected token '(.)'/.exec(msg);
  if (ex) {
    let snippet = ex[1];
    try { snippet = JSON.parse(`"${snippet}"`); } catch {}
    const at = text.indexOf(snippet);
    if (at >= 0) return lineOf(at + Math.max(0, tok ? snippet.indexOf(tok[1]) : 0));
  }
  if (/end of JSON input/.test(msg)) return text.split('\n').length;
  return 1;
}

// findings of the layouts of an app: [{ file, line, severity, message }]
export function checkForms(appDir, model, only) {
  const out = [];
  const src = path.join(appDir, 'src');
  let files = [];
  let all = [];
  try { all = fs.readdirSync(src); files = all.filter(f => f.endsWith('.form.json')); } catch { return out; }
  const store = formStore(appDir);
  // Adobe XDP layouts without a form object (src/<name>.xdp alone)
  for (const f of all.filter(x => x.endsWith('.xdp') && !all.includes(x.replace(/\.xdp$/, '.form.json')))) {
    if (only && f.replace(/\.xdp$/, '').toLowerCase() !== String(only).toLowerCase()) continue;
    out.push(...checkXdp(appDir, model, `src/${f}`, null, `src/${f}`));
  }
  for (const f of files) {
    const name = f.replace(/\.form\.json$/, '');
    if (only && name.toLowerCase() !== String(only).toLowerCase()) continue;
    const file = `src/${f}`;
    const text = fs.readFileSync(path.join(src, f), 'utf8');
    let form;
    try { form = JSON.parse(text); }
    catch (e) {
      out.push({ file, line: jsonErrorLine(text, e.message), severity: 'error', message: `The layout is not valid JSON: ${e.message.replace(/\s+/g, ' ')}` });
      continue;
    }
    const lineOf = needle => { const i = text.indexOf(needle); return i < 0 ? 1 : text.slice(0, i).split('\n').length; };
    if (!form || typeof form !== 'object' || Array.isArray(form)) { out.push({ file, line: 1, severity: 'error', message: 'A layout is a JSON object: { "title", "content": [ … ] }' }); continue; }
    // a form object with an Adobe XDP layout: { "layout": "<name>.xdp", "dataProvider" }
    if (form.layout) {
      const lf = path.join(src, path.basename(String(form.layout)));
      if (!fs.existsSync(lf)) { out.push({ file, line: lineOf('"layout"'), severity: 'error', message: `The layout ${form.layout} does not exist (src/${path.basename(String(form.layout))})` }); continue; }
      if (form.dataProvider && !fdpShape(model, form.dataProvider)) out.push({ file, line: lineOf('"dataProvider"'), severity: 'error', message: `Data provider ${form.dataProvider} not found (a service definition of this app)` });
      out.push(...checkXdp(appDir, model, `src/${path.basename(String(form.layout))}`, form.dataProvider, file));
      continue;
    }
    for (const k of Object.keys(form)) if (!KEYS.has(k)) out.push({ file, line: lineOf(`"${k}"`), severity: 'warning', message: `Unknown layout property "${k}" (${[...KEYS].join(', ')})` });
    if (!Array.isArray(form.content)) out.push({ file, line: 1, severity: 'error', message: 'The layout has no "content": [ items ]' });
    let shape = null;
    if (form.dataProvider) {
      shape = fdpShape(model, form.dataProvider);
      if (!shape) out.push({ file, line: lineOf('"dataProvider"'), severity: 'error', message: `Data provider ${form.dataProvider} not found (a service definition of this app)` });
    }
    const merge = (a, b) => {
      if (Array.isArray(a) || Array.isArray(b)) { const x = Array.isArray(a) && a.length ? a : null, y = Array.isArray(b) && b.length ? b : null; return x ? x.map(r => merge(r, y?.[0] || {})) : y || []; }
      if (a && typeof a === 'object' && b && typeof b === 'object') { const o = { ...b }; for (const [k, v] of Object.entries(a)) o[k.toLowerCase()] = merge(v, b[k.toLowerCase()]); return o; }
      return a ?? b;
    };
    const data = merge(form.sample || {}, shape || {});
    try {
      const r = renderForm(form, { sy: { datum: '20260101', uzeit: '120000', uname: 'DEVELOPER' }, ...data }, { assets: n => store.assets(n) });
      for (const w of r.warnings) {
        const field = /\{([\w./-]+)\}|(?:image|font|style|table|text module) ([\w./-]+)/i.exec(w);
        out.push({ file, line: field ? lineOf(field[1] || field[2]) : 1, severity: /not found|Unknown item|Unknown font/.test(w) ? 'error' : 'warning', message: w });
      }
    } catch (e) { out.push({ file, line: 1, severity: 'error', message: `The layout cannot be rendered: ${e.message}` }); }
  }
  return out;
}

// an XDP layout: it renders, and its data bindings ($.Alias.Element…) exist in the data provider (XFA binds by
// name, case-sensitive: element names as in the CDS view)
export function checkXdp(appDir, model, rel, srvd, ownerFile) {
  const out = [];
  const text = fs.readFileSync(path.join(appDir, rel), 'utf8');
  const lineOf = needle => { const i = text.indexOf(needle); return i < 0 ? 1 : text.slice(0, i).split('\n').length; };
  try {
    const r = renderXdp(text, null, { fontDirs: [path.join(appDir, 'fonts')], assetDir: path.join(appDir, 'src') });
    for (const w of r.warnings) if (!/not installed|not available/.test(w)) out.push({ file: rel, line: 1, severity: 'warning', message: w });
  } catch (e) { out.push({ file: rel, line: 1, severity: 'error', message: `The XDP layout cannot be rendered: ${e.message}` }); return out; }
  const srv = srvd && model?.services.get(String(srvd).toLowerCase());
  if (!srv) return out;
  const lead = String(srv.ann?.objectmodel?.leadingentity?.name || '').toLowerCase();
  const root = srv.exposes.find(e => e.entity === lead || e.alias.toLowerCase() === lead) || srv.exposes[0];
  // the element names of the data: Alias.Element, Alias.Assoc.Element, Alias._Many.RowAlias.Element …
  const paths = new Map();
  const walk = (entName, prefix, depth) => {
    const ent = model.entities.get(entName);
    if (!ent) return;
    for (const f of ent.fields) if (!f.isAssoc) paths.set(`${prefix}.${f.label || f.name}`, true);
    if (depth > 2) return;
    for (const a of ent.assocs?.values() || []) {
      if (a.toParent || !srv.exposes.some(e => e.entity === a.target)) continue;
      const p = `${prefix}.${assocName(ent, a)}`;
      paths.set(p, true);
      if (a.card?.max !== 1) { const ra = srv.exposes.find(e => e.entity === a.target).alias; paths.set(`${p}.${ra}`, true); walk(a.target, `${p}.${ra}`, depth + 1); }
      else walk(a.target, p, depth + 1);
    }
  };
  paths.set(root.alias, true);
  walk(root.entity, root.alias, 0);
  const lower = new Map([...paths.keys()].map(k => [k.toLowerCase(), k]));
  for (const m of text.matchAll(/ref="\$\.([^"]+)"/g)) {
    const ref = m[1].replace(/\[(\*|\d+)\]/g, '');
    if (!ref.startsWith(`${root.alias}.`) && ref !== root.alias && !lower.has(ref.toLowerCase())) continue;   // relative to a repeating subform
    if (paths.has(ref)) continue;
    const near = lower.get(ref.toLowerCase());
    out.push({ file: rel, line: lineOf(m[0]), severity: 'warning', message: near ? `Binding $.${m[1]}: the data has ${near} (XFA bindings are case-sensitive)` : `Binding $.${m[1]}: ${srvd.toUpperCase()} has no ${ref} (its data: ${root.alias}.…)` });
  }
  return out;
}
