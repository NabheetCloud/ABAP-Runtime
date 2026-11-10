// Native renderer of Adobe XFA form templates (.xdp, Adobe LiveCycle Designer / SAP Forms Service by Adobe): the
// template merged with XML data (the form data provider's XML, or any XML / JSON) and laid out to PDF the way Adobe
// Document Services does it:
// - template: subforms, areas, exclusion groups, draws, fields, protos (use / usehref), page sets with page areas,
//   content areas and media, master page content on every page
// - data merge: normal (by name), dataRef ($.a.b, $record, [*]), global and none bindings; repeating subforms
//   (occur min / max) one instance per data record
// - layout: positioned (x, y, anchorType, rotate 0 / 90 / 180 / 270), flowed top to bottom (tb), left to right
//   (lr-tb, rl-tb), tables (table / row, columnWidths, colSpan), growable sizes (minW / maxW / minH / maxH),
//   margins, captions (placement, reserve), presence (hidden / invisible), relevant="-print", pagination of flowed
//   content over content areas and pages (breaks, keep intact, overflow leaders repeated as table headers)
// - drawing: plain and rich text (exData XHTML: fonts, sizes, weight, posture, colors, alignment, spacing), fonts
//   (system TrueType fonts embedded, SAP-icons), paragraphs (hAlign, vAlign, spacing, indents, line height),
//   borders with edges (solid, dashed, dotted, thickness, colors, presence) and fills, lines, rectangles, arcs,
//   images (PNG, JPEG, SVG; embedded, data or files), check boxes, choice lists, numeric / date / time values
//   with picture clauses, barcodes (QR, Data Matrix, PDF417, Code 128 / 39, EAN …), page numbers
// - scripts (script.js, formcalc.js): JavaScript and FormCalc; initialize, calculate, validate, ready, prePrint on
//   the merged form (one node per instance, its own copy of the template: presence and colours set by scripts)
// - interactive output (option interactive, or the form's config present/pdf/interactive): open input fields as
//   fillable PDF fields named by their SOM expression
import fs from 'node:fs';
import path from 'node:path';
import { parseXml } from '../../abap/xslt.js';
import { Pdf, FONTS, readImage, textWidth as stdWidth } from '../pdf.js';
import { barcode } from '../barcode.js';
import { resolveFont } from './fonts.js';
import { formatPicture, parseDate, isInitialDate } from './picture.js';
import { svgImage } from './svg.js';
import { createScriptHost, usesLayout } from './script.js';
import { ACROBAT_PRELUDE, numberFormat } from './acrobat.js';
import { pdfaFonts } from '../pdfa.js';

const num = v => (Math.round(Number(v) * 1000) / 1000).toString();
// XFA measurements: in (default), mm, cm, pt, px
export const unit = (v, def = 0) => {
  if (v === undefined || v === null || v === '') return def;
  const m = /^\s*(-?[\d.]+)\s*(mm|cm|in|pt|px|mp)?\s*$/.exec(String(v));
  if (!m) return def;
  const n = Number(m[1]);
  return m[2] === 'mm' ? n * 72 / 25.4 : m[2] === 'cm' ? n * 72 / 2.54 : m[2] === 'pt' || m[2] === 'px' ? n : m[2] === 'mp' ? n / 1000 : n * 72;
};
const PROPS = new Set(['font', 'para', 'margin', 'border', 'caption', 'ui', 'value', 'bind', 'format', 'items', 'fill', 'edge', 'corner', 'occur', 'keep', 'break', 'breakBefore', 'breakAfter', 'overflow', 'medium', 'assist', 'validate', 'calculate', 'textEdit', 'numericEdit', 'dateTimeEdit', 'checkButton', 'choiceList', 'imageEdit', 'barcode', 'signature', 'button', 'passwordEdit', 'defaultUi', 'picture', 'color', 'extras', 'desc', 'traversal', 'comb', 'linear', 'radial', 'pattern', 'stipple', 'solid']);

// ---------------------------------------------------------------- template
// $path: the element's position in the template (child indices from <template>), for the visual designer
function toNode(x, parent, path = '') {
  const n = { tag: String(x.name).replace(/^.*:/, ''), a: {}, kids: [], parent, text: '', raw: x, $path: path };
  for (const at of x.attrs || []) n.a[String(at.name).replace(/^.*:/, '') === at.name ? at.name : at.name] = at.value;
  let i = 0;
  for (const c of x.children || []) {
    if (c.type === 'element') n.kids.push(toNode(c, n, path === '' && !parent ? String(i++) : `${path}/${i++}`));
    else if (c.type === 'text') n.text += c.value;
  }
  return n;
}
const kid = (n, tag) => (n?.kids || []).find(k => k.tag === tag);
const kidsOf = (n, tag) => (n?.kids || []).filter(k => k.tag === tag);
function deepText(n) { return n ? n.text + n.kids.map(deepText).join('') : ''; }

// protos: <x use="#id"> / usehref="#id" / ".#som": the proto's attributes and properties are the defaults
function resolveProtos(root) {
  const ids = new Map(), names = new Map();
  (function index(n) { if (n.a.id) ids.set(n.a.id, n); if (n.a.name && n.parent?.tag === 'proto') names.set(n.a.name, n); n.kids.forEach(index); })(root);
  const merge = (n, p, depth = 0) => {
    if (!p || depth > 20) return;
    const pr = protoOf(p);
    if (pr && pr !== p) merge(p, pr, depth + 1);
    for (const [k, v] of Object.entries(p.a)) if (!(k in n.a) && k !== 'id' && k !== 'use' && k !== 'usehref') n.a[k] = v;
    for (const pk of p.kids) {
      const own = PROPS.has(pk.tag) ? n.kids.find(k => k.tag === pk.tag) : null;
      if (own) merge(own, pk, depth + 1);
      else if (PROPS.has(pk.tag) || !n.kids.length || pk.tag !== 'subform') n.kids.push(clone(pk, n));
    }
    if (!n.text && p.text.trim()) n.text = p.text;
  };
  const clone = (n, parent) => { const c = { ...n, a: { ...n.a }, parent, kids: [] }; c.kids = n.kids.map(k => clone(k, c)); return c; };
  const protoOf = n => {
    const ref = n.a.use || n.a.usehref;
    if (!ref) return null;
    const m = /#(.+)$/.exec(ref);
    if (!m) return null;
    const key = m[1].replace(/^som\(|\)$/g, '');
    return ids.get(key) || names.get(key.split('.').pop()) || null;
  };
  (function walk(n) {
    if (n.tag === 'proto') return;
    const p = protoOf(n);
    if (p) merge(n, p);
    n.kids.forEach(walk);
  })(root);
}

// ---------------------------------------------------------------- data
function dataNode(name, parent) { return { name, kids: [], text: '', attrs: {}, parent }; }
function xmlToData(xml) {
  const doc = parseXml(String(xml).replace(/^﻿/, ''));
  const conv = (x, parent) => {
    const d = dataNode(String(x.name).replace(/^.*:/, ''), parent);
    for (const a of x.attrs || []) d.attrs[String(a.name).replace(/^.*:/, '')] = a.value;
    for (const c of x.children || []) {
      if (c.type === 'element') d.kids.push(conv(c, d));
      else if (c.type === 'text') d.text += c.value;
    }
    return d;
  };
  let top = (doc.children || []).find(c => c.type === 'element');
  if (!top) return dataNode('data');
  // <xdp:xdp><xfa:datasets><xfa:data><Form> … : the data group under xfa:data
  // (a plain <data> root, e.g. the classic interface's XML, is the data itself)
  const unwrap = (n, inside) => { const nm = String(n.name).replace(/^.*:/, ''); if (nm === 'xdp' || nm === 'datasets' || (nm === 'data' && (inside || String(n.name).includes(':')))) { const c = (n.children || []).find(k => k.type === 'element' && /datasets|data$/.test(String(k.name))) || (n.children || []).find(k => k.type === 'element'); return c ? unwrap(c, nm !== 'data') : n; } return n; };
  top = unwrap(top, false);
  return conv(top, null);
}
function objToData(name, v, parent) {
  const d = dataNode(name, parent);
  if (Array.isArray(v)) for (const r of v) d.kids.push(objToData('DATA', r, d));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) {
    if (Array.isArray(x)) { const w = dataNode(k, d); d.kids.push(w); for (const r of x) w.kids.push(objToData(k, r, w)); }
    else d.kids.push(objToData(k, x, d));
  } else d.text = v === null || v === undefined ? '' : String(v);
  return d;
}
const byName = (d, name) => {
  if (!d) return [];
  const exact = d.kids.filter(k => k.name === name);
  return exact.length ? exact : d.kids.filter(k => k.name.toLowerCase() === String(name).toLowerCase());
};
// a SOM data reference relative to a data node: $.A.B[*], $record.A, $data.A, A.B, $
function resolveRef(ref, ctx, record) {
  let r = String(ref || '').trim();
  let base = ctx;
  if (/^\$record\b/.test(r)) { base = record; r = r.replace(/^\$record\.?/, ''); }
  else if (/^\$data\b/.test(r)) { base = record; r = r.replace(/^\$data\.?/, ''); }
  else if (/^!/.test(r)) { base = record; r = r.slice(1); }
  else if (/^\$/.test(r)) r = r.replace(/^\$\.?/, '');
  if (!r) return { nodes: base ? [base] : [], many: false };
  const steps = r.split('.').filter(Boolean).map(s => { const m = /^([^[]+)(?:\[(\*|\d+)\])?$/.exec(s); return { name: m ? m[1] : s, idx: m?.[2] }; });
  const walk = start => {
    let cur = [start], many = false;
    for (const [i, st] of steps.entries()) {
      const next = [];
      for (const c of cur) {
        // rows of a table: Items.DATA (classic interfaces), FDP: _Assoc wraps its rows
        let found = byName(c, st.name);
        if (!found.length && /^DATA$/i.test(st.name)) found = c.kids;
        next.push(...found);
      }
      if (st.idx === '*') { cur = next; many = true; }
      else cur = next.length ? [next[Math.min(Number(st.idx || 0), next.length - 1)]] : [];
      if (!cur.length) return null;
      if (i < steps.length - 1 && many) cur = cur.slice(0, 1).concat(cur.slice(1));
    }
    return { nodes: cur, many };
  };
  // relative to the context, then to its ancestors (a $.Ticket.… reference inside the Ticket subform)
  for (let b = base; b; b = b.parent) { const r2 = walk(b); if (r2) return r2; }
  return { nodes: [], many: false };
}

// ---------------------------------------------------------------- styles
const colorOf = n => { const c = kid(n, 'color'); const v = c?.a.value; if (!v) return null; const p = v.split(',').map(Number); return p.length >= 3 ? p.slice(0, 3) : null; };
function fontOf(n, inh) {
  const f = kid(n, 'font');
  const base = inh || { typeface: 'Courier', size: 10, weight: 'normal', posture: 'normal', color: [0, 0, 0], underline: 0 };
  if (!f) return base;
  return { typeface: f.a.typeface || base.typeface, size: f.a.size ? unit(f.a.size.replace(/^([\d.]+)$/, '$1pt')) : base.size, weight: f.a.weight || base.weight, posture: f.a.posture || base.posture,
    color: colorOf(kid(f, 'fill')) || base.color, underline: Number(f.a.underline || 0), baselineShift: unit(f.a.baselineShift || 0), lineThrough: Number(f.a.lineThrough || 0) };
}
function paraOf(n, inh) {
  const p = kid(n, 'para');
  const base = inh || { hAlign: 'left', vAlign: 'top', spaceAbove: 0, spaceBelow: 0, marginLeft: 0, marginRight: 0, textIndent: 0, lineHeight: 0 };
  if (!p) return base;
  return { hAlign: p.a.hAlign || base.hAlign, vAlign: p.a.vAlign || base.vAlign, spaceAbove: unit(p.a.spaceAbove, 0), spaceBelow: unit(p.a.spaceBelow, 0),
    marginLeft: unit(p.a.marginLeft, 0), marginRight: unit(p.a.marginRight, 0), textIndent: unit(p.a.textIndent, 0), lineHeight: unit(p.a.lineHeight, 0) };
}
const marginOf = n => { const m = kid(n, 'margin'); return { t: unit(m?.a.topInset), r: unit(m?.a.rightInset), b: unit(m?.a.bottomInset), l: unit(m?.a.leftInset) }; };
// border: edges (top, right, bottom, left; fewer repeat the last), corners, fill
function borderOf(n) {
  const b = kid(n, 'border');
  if (!b || b.a.presence === 'hidden' || b.a.presence === 'invisible' || b.a.presence === 'inactive') return null;
  const edges = kidsOf(b, 'edge').map(e => ({ presence: e.a.presence || 'visible', stroke: e.a.stroke || 'solid', w: unit(e.a.thickness, 0.5), color: colorOf(e) || [0, 0, 0], cap: e.a.cap }));
  const four = [0, 1, 2, 3].map(i => edges[Math.min(i, edges.length - 1)]).map(e => (e && e.presence === 'visible' ? e : null));
  const corner = kid(b, 'corner');
  const fillN = kid(b, 'fill');
  const fill = fillN && fillN.a.presence !== 'hidden' && fillN.a.presence !== 'invisible' ? colorOf(fillN) || [255, 255, 255] : null;
  return { edges: edges.length ? four : [null, null, null, null], radius: unit(corner?.a.radius, 0), fill, hand: b.a.hand || 'even' };
}
// colours set by scripts (fillColor, borderColor, border.fill.color.value) on the instance's template copy
function borderOfNode(n) {
  let b = n.$borderPresence === 'hidden' || n.$borderPresence === 'invisible' ? null : borderOf(n);
  if (n.$fill !== undefined) { b ||= { edges: [null, null, null, null], radius: 0, fill: null, hand: 'even' }; b = { ...b, fill: n.$fill && n.$fill.length >= 3 ? n.$fill : null }; }
  if (n.$borderColor?.length >= 3 && b) b = { ...b, edges: b.edges.map(e => (e ? { ...e, color: n.$borderColor } : e)) };
  return b;
}
const visible = n => !['hidden', 'inactive'].includes(n.a.presence) && !/(^|\s)-print/.test(n.a.relevant || '');
const shown = n => visible(n) && n.a.presence !== 'invisible';

// ---------------------------------------------------------------- rich text
const SPACE = /[ \t ]/;
function cssOf(style) { return Object.fromEntries(String(style || '').split(';').map(s => { const i = s.indexOf(':'); return i < 0 ? null : [s.slice(0, i).trim().toLowerCase(), s.slice(i + 1).trim()]; }).filter(Boolean)); }
function cssSize(v) { const m = /^([\d.]+)\s*(pt|px|in|mm|cm)?$/.exec(String(v || '').trim()); return m ? unit(`${m[1]}${m[2] === 'px' ? 'pt' : m[2] || 'pt'}`) : null; }
function cssColor(v) {
  const s = String(v || '').trim().toLowerCase();
  let m = /^#([0-9a-f]{6})$/.exec(s); if (m) return [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16));
  m = /^#([0-9a-f]{3})$/.exec(s); if (m) return [...m[1]].map(c => parseInt(c + c, 16));
  m = /^rgb\((\d+)\D+(\d+)\D+(\d+)/.exec(s); if (m) return [m[1], m[2], m[3]].map(Number);
  return ({ black: [0, 0, 0], white: [255, 255, 255], red: [255, 0, 0], blue: [0, 0, 255], green: [0, 128, 0], gray: [128, 128, 128], grey: [128, 128, 128] })[s] || null;
}
function applyCss(font, para, css) {
  const f = { ...font }, p = { ...para };
  if (css['font-family']) f.typeface = css['font-family'].split(',')[0].replace(/['"]/g, '').trim();
  if (css['font-size']) f.size = cssSize(css['font-size']) ?? f.size;
  if (css['font-weight']) f.weight = /bold|[6-9]00/.test(css['font-weight']) ? 'bold' : 'normal';
  if (css['font-style']) f.posture = /italic|oblique/.test(css['font-style']) ? 'italic' : 'normal';
  if (css.color) f.color = cssColor(css.color) || f.color;
  if (css['text-decoration']) f.underline = /underline/.test(css['text-decoration']) ? 1 : 0;
  if (css['text-align']) p.hAlign = css['text-align'];
  if (css['margin-left']) p.marginLeft = cssSize(css['margin-left']) ?? p.marginLeft;
  if (css['margin-right']) p.marginRight = cssSize(css['margin-right']) ?? p.marginRight;
  if (css['margin-top']) p.spaceAbove = cssSize(css['margin-top']) ?? p.spaceAbove;
  if (css['margin-bottom']) p.spaceBelow = cssSize(css['margin-bottom']) ?? p.spaceBelow;
  if (css['space-before']) p.spaceAbove = cssSize(css['space-before']) ?? p.spaceAbove;
  if (css['space-after']) p.spaceBelow = cssSize(css['space-after']) ?? p.spaceBelow;
  if (css['text-indent']) p.textIndent = cssSize(css['text-indent']) ?? p.textIndent;
  if (css['line-height']) p.lineHeight = cssSize(css['line-height']) ?? p.lineHeight;
  return { font: f, para: p };
}
// XHTML of an exData -> paragraphs [{ para, runs: [{ text, font }] }]
function richParas(body, font, para, embed) {
  const paras = [];
  let cur = null;
  const startPara = (p) => { cur = { para: p, runs: [] }; paras.push(cur); };
  const walk = (n, f, p, keepSpaces) => {
    for (const c of n.children || []) {
      if (c.type === 'text') {
        if (!cur) startPara(p);
        let t = c.value.replace(/[\r\n]+\s*/g, keepSpaces ? '' : ' ');
        if (!keepSpaces) t = t.replace(/[ \t]+/g, ' ');
        if (t) cur.runs.push({ text: t, font: f });
        continue;
      }
      if (c.type !== 'element') continue;
      const tag = String(c.name).replace(/^.*:/, '').toLowerCase();
      const style = (c.attrs || []).find(a => a.name === 'style')?.value;
      const css = cssOf(style);
      const { font: f2, para: p2 } = applyCss(f, p, css);
      const spacerun = /xfa-spacerun\s*:\s*yes/.test(style || '');
      if (tag === 'br') { if (!cur) startPara(p); cur.runs.push({ text: '\n', font: f }); continue; }
      // a floating field (or a data reference) embedded in the text: its formatted value
      const em = (c.attrs || []).find(a => /(^|:)embed$/.test(a.name))?.value;
      if (em && embed) { if (!cur) startPara(p); const t = embed(em, (c.attrs || []).find(a => /(^|:)embedType$/.test(a.name))?.value); if (t) cur.runs.push({ text: t, font: f2 }); continue; }
      if (tag === 'p' || tag === 'div' || tag === 'li') {
        startPara(p2);
        walk(c, f2, p2, spacerun);
        cur = null;
        continue;
      }
      if (tag === 'b' || tag === 'strong') { walk(c, { ...f2, weight: 'bold' }, p, spacerun || keepSpaces); continue; }
      if (tag === 'i' || tag === 'em') { walk(c, { ...f2, posture: 'italic' }, p, spacerun || keepSpaces); continue; }
      if (tag === 'u') { walk(c, { ...f2, underline: 1 }, p, spacerun || keepSpaces); continue; }
      if (tag === 'body' || tag === 'html') { const r = applyCss(f, p, css); walk(c, r.font, r.para, spacerun); continue; }
      walk(c, f2, p, spacerun || keepSpaces);
    }
  };
  walk(body, font, para, false);
  // a paragraph's leading / trailing blanks (from the XML's indentation) are not text
  for (const pg of paras) {
    while (pg.runs.length && !pg.runs[0].text.replace(/^ +/, '')) pg.runs.shift();
    if (pg.runs.length) pg.runs[0].text = pg.runs[0].text.replace(/^ +/, '');
    while (pg.runs.length && !pg.runs.at(-1).text.replace(/ +$/, '')) pg.runs.pop();
    if (pg.runs.length) pg.runs.at(-1).text = pg.runs.at(-1).text.replace(/ +$/, '');
  }
  return paras.length ? paras : [{ para, runs: [] }];
}

// ---------------------------------------------------------------- the renderer
export function renderXdp(xdp, data, options = {}) {
  // userDateFormat (classic print programs: the user's format DD.MM.YYYY, as in lists): a date of the data (an ISO
  // date, as the data XML carries ABAP dates) shown in a field without a picture clause
  const { locale: loc, title, fontDirs = [], assetDir = null, interactive, design = false, pdfa = false, security = null, userDateFormat = null, __pass = 0 } = options;
  // scripts that ask where objects landed (xfa.layout.h / w / x / y / page( node ) / pageContent): a first layout
  // pass gives the geometry, the second pass runs the scripts with it
  const geometryPass = __pass === 0 && /layout\.(h|w|x|y|pageSpan|pageContent|absPage)\s*\(|layout\.page\s*\(\s*(?!this\b)[^)]/.test(String(xdp))
    ? renderXdp(xdp, data, { ...options, design: true, pdfa: false, security: null, interactive: false, __pass: 1 }).layout : null;
  // design: where each template object was painted (page, x, y, w, h in points from the top left) for the designer
  const boxes = design ? [] : null;
  let pageIndex = 0;
  const mark = (n, x, y, w, h) => { if (boxes && n.$path !== undefined) boxes.push({ path: n.$path, tag: n.tag, name: n.a.name || '', page: pageIndex, x, y, w, h }); };
  const warnings = [];
  const warn = m => { if (!warnings.includes(m)) warnings.push(m); };
  const doc = parseXml(String(xdp).replace(/^﻿/, ''));
  const find = (x, nm) => { for (const c of (x.children || [])) { if (c.type !== 'element') continue; if (String(c.name).replace(/^.*:/, '') === nm) return c; const r = find(c, nm); if (r) return r; } return null; };
  const tplX = find(doc, 'template');
  if (!tplX) throw new Error('No XFA template in the layout (an .xdp from Adobe LiveCycle Designer is expected)');
  const tpl = toNode(tplX, null);
  resolveProtos(tpl);
  const idMap = new Map();
  (function index(n) { if (n.a.id) idMap.set(n.a.id, n); n.kids.forEach(index); })(tpl);
  const root = kid(tpl, 'subform');
  if (!root) throw new Error('The template has no root subform');
  // interactive (fillable): the option, else the form's own setting (Designer: config <present><pdf><interactive>1)
  const cfgInteractive = (() => { const pr = find(doc, 'present'); const pdfN = pr && find(pr, 'pdf'); const it = pdfN && find(pdfN, 'interactive'); return it ? (it.children || []).map(c => c.value || '').join('').trim() === '1' : false; })();
  const fillable = interactive ?? cfgInteractive;
  let rotated = 0;
  // data: the XML of the form data provider (or data embedded in the XDP), or an object
  let record;
  if (data === undefined || data === null || data === '') { const ds = find(doc, 'datasets'); record = ds ? xmlToData(`<x>${''}</x>`) : dataNode(root.a.name || 'data'); if (ds) { const dd = find(ds, 'data'); const top = dd && (dd.children || []).find(c => c.type === 'element'); if (top) record = xmlToData(serialize(top)); } }
  else if (typeof data === 'string' || Buffer.isBuffer(data)) record = xmlToData(String(data));
  else record = objToData(root.a.name || 'Form', data, null);
  const locale = (loc || (root.a.locale && root.a.locale !== 'ambient' ? root.a.locale : '') || 'en_US').replace('-', '_');

  const pdf = new Pdf({ title: title || root.a.name || 'Form' });
  // PDF/A: every font embedded (fonts that are not installed: an embedded sans serif), no encryption, no JavaScript
  const archive = pdfa ? pdfaFonts() : null;
  if (pdfa && !archive) throw new Error('PDF/A needs the embedded fallback font (@expo-google-fonts/arimo): npm install');
  if (pdfa && security) warn('A PDF/A document cannot be encrypted: the security settings are not used');
  const archiveFont = style => { const nm = ['pdfa-sans', 'pdfa-sans-bold', 'pdfa-sans-italic', 'pdfa-sans-bolditalic'][style]; if (!pdf.fonts.has(nm)) pdf.addFont(nm, archive[['regular', 'bold', 'italic', 'bolditalic'][style]]); const emb = pdf.fonts.get(nm); return { name: nm, id: emb.id, ttf: emb.ttf }; };
  if (archive && fillable) { archiveFont(0); pdf.fieldFont = 'pdfa-sans'; }
  // ---- fonts (embedded TrueType or standard)
  const fontCache = new Map();
  const fontRef = f => {
    const key = `${f.typeface}|${f.weight}|${f.posture}`;
    if (fontCache.has(key)) return fontCache.get(key);
    const r = resolveFont(f.typeface, f.weight, f.posture, fontDirs);
    let ref;
    if (r.file) {
      try { pdf.addFont(r.name, readFontFile(r.file)); const emb = pdf.fonts.get(r.name); ref = { name: r.name, id: emb.id, ttf: emb.ttf }; }
      catch (e) { warn(`Font ${f.typeface}: ${e.message}`); ref = { name: 'Helvetica', id: FONTS.Helvetica }; }
    } else if (archive && !r.missing) {
      ref = archiveFont((f.weight === 'bold' ? 1 : 0) + (f.posture === 'italic' ? 2 : 0));
    } else {
      if (r.missing) warn(`The font ${r.missing} is not available (no network to fetch it): its icons are left out`);
      if (r.substitute) warn(`The font ${r.substitute} is not installed: ${r.name} is used`);
      ref = { name: r.name, id: FONTS[r.name] || 'F1', missing: !!r.missing };
    }
    fontCache.set(key, ref);
    return ref;
  };
  const metrics = (ref, size) => ref.ttf ? { asc: ref.ttf.ascent / 1000 * size, desc: -ref.ttf.descent / 1000 * size } : { asc: 0.905 * size, desc: 0.212 * size };
  const width = (text, ref, size) => (ref.missing ? 0 : ref.ttf ? pdf.textWidth(text, ref.name, size) : stdWidth(text, ref.name, size));

  // ---- text layout: paragraphs of runs -> lines of segments, wrapped at a width (Infinity: no wrapping)
  const layoutText = (paras, maxW) => {
    const lines = [];
    for (const pg of paras) {
      const p = pg.para;
      const avail = maxW - p.marginLeft - p.marginRight;
      let line = null;
      const newLine = (first) => { line = { segs: [], w: 0, asc: 0, desc: 0, para: p, indent: first ? p.textIndent : 0, first }; lines.push(line); };
      newLine(true);
      line.spaceAbove = p.spaceAbove;
      const words = [];
      for (const r of pg.runs) {
        const ref = fontRef(r.font);
        for (const piece of r.text.split(/(\n| +)/)) if (piece) words.push({ text: piece, font: r.font, ref });
      }
      const place = w => {
        const sz = w.font.size, m = metrics(w.ref, sz);
        line.asc = Math.max(line.asc, m.asc); line.desc = Math.max(line.desc, m.desc);
        const last = line.segs.at(-1);
        const ww = width(w.text, w.ref, sz);
        if (last && last.font === w.font) { last.text += w.text; last.w += ww; } else line.segs.push({ text: w.text, font: w.font, ref: w.ref, w: ww });
        line.w += ww;
      };
      for (const w of words) {
        if (w.text === '\n') { if (!line.asc) { const m = metrics(w.ref, w.font.size); line.asc = m.asc; line.desc = m.desc; } newLine(false); continue; }
        const ww = width(w.text, w.ref, w.font.size);
        if (/^ +$/.test(w.text)) { if (line.segs.length) place(w); continue; }
        if (line.segs.length && line.w + line.indent + ww > avail + 0.01 && Number.isFinite(avail)) {
          // trailing blanks do not count
          const last = line.segs.at(-1); if (last) { const t = last.text.replace(/ +$/, ''); const cut = last.text.length - t.length; if (cut) { const d = width(' '.repeat(cut), last.ref, last.font.size); last.text = t; last.w -= d; line.w -= d; } }
          newLine(false);
        }
        place(w);
      }
      if (!line.asc) { const f = pg.runs[0]?.font || { typeface: 'Arial', size: 10, weight: 'normal', posture: 'normal' }; const m = metrics(fontRef(f), f.size); line.asc = m.asc; line.desc = m.desc; }
      line.spaceBelow = p.spaceBelow;
    }
    for (const l of lines) l.h = l.para.lineHeight || (l.asc + l.desc);
    const h = lines.reduce((s, l) => s + l.h + (l.spaceAbove || 0) + (l.spaceBelow || 0), 0);
    const w = lines.reduce((s, l) => Math.max(s, l.w + l.indent + l.para.marginLeft + l.para.marginRight), 0);
    return { lines, w, h };
  };

  // ---- the page canvas (y down, points)
  let page = null;
  const ops = s => page.ops.push(s);
  const rgb = c => (c || [0, 0, 0]).map(x => num(x / 255)).join(' ');
  const drawText = (layout, x, y, w, h, vAlign) => {
    let cy = y + (vAlign === 'middle' ? (h - layout.h) / 2 : vAlign === 'bottom' ? h - layout.h : 0);
    for (const l of layout.lines) {
      cy += l.spaceAbove || 0;
      const p = l.para, avail = w - p.marginLeft - p.marginRight;
      let cx = x + p.marginLeft + l.indent;
      const al = p.hAlign;
      if (al === 'center') cx += (avail - l.indent - l.w) / 2;
      else if (al === 'right') cx += avail - l.indent - l.w;
      const base = cy + (l.para.lineHeight ? (l.h - (l.asc + l.desc)) / 2 : 0) + l.asc;
      const lineText = l.segs.filter(s => !s.ref.missing).map(s => s.text).join('').replace(/[\uE000-\uF8FF]/g, '').trim();
      if (lineText) (page.$text ||= []).push(lineText);
      for (const s of l.segs) {
        if (s.ref.missing) { cx += s.w; continue; }
        const t = s.text;
        if (t.trim()) ops(`BT /${s.ref.id} ${num(s.font.size)} Tf ${rgb(s.font.color)} rg 1 0 0 -1 ${num(cx)} ${num(base - (s.font.baselineShift || 0))} Tm ${pdf.encode(t, s.ref.name)} Tj ET`);
        if (s.font.underline) ops(`q ${rgb(s.font.color)} RG 0.5 w ${num(cx)} ${num(base + 1.5)} m ${num(cx + s.w)} ${num(base + 1.5)} l S Q`);
        cx += s.w;
      }
      cy += l.h + (l.spaceBelow || 0);
    }
  };
  const DASH = { dashed: '[3 2] 0 d', dotted: '[1 1.5] 0 d', dashDot: '[3 1.5 1 1.5] 0 d', dashDotDot: '[3 1.5 1 1.5 1 1.5] 0 d' };
  const drawBorder = (b, x, y, w, h) => {
    if (!b) return;
    if (b.fill) ops(`q ${rgb(b.fill)} rg ${num(x)} ${num(y)} ${num(w)} ${num(h)} re f Q`);
    const [t, r, bt, l] = b.edges;
    const same = t && r && bt && l && [r, bt, l].every(e => e.w === t.w && e.stroke === t.stroke && e.color.join() === t.color.join());
    const st = e => `${rgb(e.color)} RG ${num(e.w)} w ${DASH[e.stroke] || ''}`;
    if (same) {
      // even: the stroke is centered on the edge
      if (b.radius) { const k = 0.5523 * b.radius, R = b.radius; ops(`q ${st(t)} ${num(x + R)} ${num(y)} m ${num(x + w - R)} ${num(y)} l ${num(x + w - R + k)} ${num(y)} ${num(x + w)} ${num(y + R - k)} ${num(x + w)} ${num(y + R)} c ${num(x + w)} ${num(y + h - R)} l ${num(x + w)} ${num(y + h - R + k)} ${num(x + w - R + k)} ${num(y + h)} ${num(x + w - R)} ${num(y + h)} c ${num(x + R)} ${num(y + h)} l ${num(x + R - k)} ${num(y + h)} ${num(x)} ${num(y + h - R + k)} ${num(x)} ${num(y + h - R)} c ${num(x)} ${num(y + R)} l ${num(x)} ${num(y + R - k)} ${num(x + R - k)} ${num(y)} ${num(x + R)} ${num(y)} c h S Q`); }
      else ops(`q ${st(t)} ${num(x)} ${num(y)} ${num(w)} ${num(h)} re S Q`);
      return;
    }
    const seg = (e, x1, y1, x2, y2) => { if (e) ops(`q ${st(e)} ${num(x1)} ${num(y1)} m ${num(x2)} ${num(y2)} l S Q`); };
    seg(t, x, y, x + w, y); seg(r, x + w, y, x + w, y + h); seg(bt, x, y + h, x + w, y + h); seg(l, x, y, x, y + h);
  };
  const imgCache = new Map();
  const drawImage = (buf, contentType, x, y, w, h, aspect = 'fit') => {
    try {
      const isSvg = /svg/.test(contentType || '') || /^\s*(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*<svg/i.test(buf.subarray(0, 600).toString('utf8'));
      if (isSvg) {
        const svg = svgImage(buf.toString('utf8'));
        const [sw, sh, ox, oy] = fit(svg.width, svg.height, w, h, aspect);
        ops(`q ${num(x + ox)} ${num(y + oy)} ${num(w)} ${num(h)} re W n 1 0 0 1 ${num(x + ox)} ${num(y + oy)} cm ${num(sw / svg.width)} 0 0 ${num(sh / svg.height)} 0 0 cm`);
        ops(svg.ops((tx, ty, s, o) => {
          const f = { typeface: o.family || 'Arial', size: o.size, weight: /bold|[6-9]00/.test(o.weight || '') ? 'bold' : 'normal', posture: 'normal' };
          const ref = fontRef(f);
          const tw = width(s, ref, o.size);
          const ax = o.anchor === 'middle' ? tx - tw / 2 : o.anchor === 'end' ? tx - tw : tx;
          return `BT /${ref.id} ${num(o.size)} Tf ${o.color.map(num).join(' ')} rg 1 0 0 -1 ${num(ax)} ${num(ty)} Tm ${pdf.encode(s, ref.name)} Tj ET`;
        }));
        ops('Q');
        return;
      }
      let img = imgCache.get(buf);
      if (!img) { img = readImage(buf); imgCache.set(buf, img); }
      let k = pdf.images.indexOf(img);
      if (k < 0) { pdf.images.push(img); k = pdf.images.length - 1; }
      const [iw, ih, ox, oy] = fit(img.width, img.height, w, h, aspect);
      ops(`q ${num(x)} ${num(y)} ${num(w)} ${num(h)} re W n ${num(iw)} 0 0 ${num(-ih)} ${num(x + ox)} ${num(y + oy + ih)} cm /Im${k} Do Q`);
    } catch (e) { warn(`Image: ${e.message}`); }
  };
  const fit = (iw, ih, w, h, aspect) => {
    if (aspect === 'none' || !iw || !ih) return [w, h, 0, 0];
    if (aspect === 'actual') return [iw * 0.75, ih * 0.75, 0, 0];
    const s = aspect === 'width' ? w / iw : aspect === 'height' ? h / ih : Math.min(w / iw, h / ih);
    return [iw * s, ih * s, 0, 0];
  };

  // ---- values
  const valueKind = v => v ? (v.kids.find(k => PROPS.has(k.tag) === false || ['text', 'exData', 'date', 'time', 'dateTime', 'decimal', 'float', 'integer', 'boolean', 'image', 'line', 'rectangle', 'arc'].includes(k.tag)) || null) : null;
  const imageBytes = (imgNode, dataNode) => {
    // data: base64 (FDP: the field's content, e.g. a logo); template: base64 content or href
    const src = dataNode ? dataNode.text.trim() : (imgNode?.text || '').trim();
    if (src && src.length > 32 && /^[A-Za-z0-9+/=\s]+$/.test(src)) { try { const b = Buffer.from(src.replace(/\s+/g, ''), 'base64'); if (b.length > 8) return b; } catch {} }
    const href = imgNode?.a.href;
    if (href && opts.assetDir) { const f = path.join(opts.assetDir, path.basename(href)); if (fs.existsSync(f)) return fs.readFileSync(f); }
    if (href) warn(`Image ${href}: not found (linked images: put the file next to the form)`);
    return null;
  };
  const opts = { assetDir };

  // ---------------------------------------------------------------- layout
  // a box: { w, h, paint(x, y) } (+ flow: [{ box, dx }] when a flowed container may be split over pages)
  const space = (n) => ({ w: 0, h: 0, paint() {} });

  // the value of a field: data (bound) or the template's
  function fieldValue(n, ctx) {
    const b = kid(n, 'bind');
    const match = b?.a.match || 'once';
    let dn = null;
    if (match === 'none') dn = null;
    else if (match === 'dataRef' && b.a.ref) dn = resolveRef(b.a.ref, ctx, record).nodes[0] || null;
    else if (match === 'global') dn = findGlobal(record, n.a.name);
    else if (n.a.name && ctx) dn = byName(ctx, n.a.name)[0] || null;
    const v = kid(n, 'value');
    const vk = valueKind(v);
    let raw = dn ? dn.text : vk ? (vk.tag === 'exData' ? null : deepText(vk).trim()) : '';
    // a data picture (bind picture): the data's format
    return { raw: raw ?? '', dn, vk, bindPicture: kid(b, 'picture')?.text?.trim() };
  }
  const findGlobal = (d, name) => { if (!d) return null; if (d.name === name && !d.kids.length) return d; for (const k of d.kids) { const r = findGlobal(k, name); if (r) return r; } return null; };
  const displayOf = (n, raw, vk, ctxTag) => {
    const pic = kid(kid(n, 'format'), 'picture')?.text?.trim();
    let kind = vk?.tag || 'text';
    const ui = kid(n, 'ui');
    const uiKind = ui?.kids[0]?.tag;
    if (uiKind === 'dateTimeEdit' && kind === 'text') kind = 'date';
    if (uiKind === 'choiceList') {   // the display text of the saved value
      const lists = kidsOf(n, 'items');
      if (lists.length) { const save = lists.find(l => l.a.save === '1') || lists.at(-1), disp = lists.find(l => l.a.save !== '1') || lists[0]; const i = save.kids.findIndex(k => deepText(k).trim() === String(raw)); if (i >= 0 && disp.kids[i]) return deepText(disp.kids[i]).trim(); }
    }
    if (raw === '' || raw === null || raw === undefined) return '';
    const loc = n.a.locale && n.a.locale !== 'ambient' ? n.a.locale : locale;
    if (pic) { const r = formatPicture(raw, pic, loc, kind); return r === null ? String(raw) : r; }
    if (kind === 'date' && isInitialDate(raw)) return '';
    if (kind === 'date' && parseDate(raw)) return userDateFormat ? formatPicture(raw, `date{${userDateFormat}}`, loc, 'date') : formatPicture(raw, 'date.medium{}', loc, 'date');
    if (userDateFormat && /^\d{4}-\d{2}-\d{2}$/.test(String(raw).trim()) && parseDate(raw)) return formatPicture(String(raw).trim(), `date{${userDateFormat}}`, loc, 'date');
    return String(raw);
  };

  // a field or draw -> box
  // the fields of a fillable PDF: open input fields, and calculated fields (read-only, their scripts keep them current)
  const UI_FIELDS = ['textEdit', 'numericEdit', 'dateTimeEdit', 'checkButton', 'choiceList', 'signature', 'passwordEdit'];
  const uiOf = n => kid(n, 'ui')?.kids[0]?.tag || 'textEdit';
  const calcOf = n => deepText(kid(kid(n, 'calculate'), 'script')).trim();
  const willBeField = fn => !!fillable && fn?.tpl?.tag === 'field' && !fn.inPage && shown(fn.tpl) && UI_FIELDS.includes(uiOf(fn.tpl))
    && (!/^(readOnly|protected|nonInteractive)$/.test(fn.tpl.a.access || '') || (!!calcOf(fn.tpl) && !usesLayout(calcOf(fn.tpl))));
  function leaf(fn, avail, over) {
    const n = over ? { ...fn.tpl, a: { ...fn.tpl.a, ...over } } : fn.tpl;
    const isField = n.tag === 'field';
    const m = marginOf(n);
    const font = n.$fontColor?.length >= 3 ? { ...fontOf(n), color: n.$fontColor } : fontOf(n);
    const para = paraOf(n);
    const border = borderOfNode(n);
    const ui = kid(n, 'ui'), uiKind = ui?.kids[0]?.tag || (isField ? 'textEdit' : null), uiNode = ui?.kids[0];
    let { raw, dn, vk } = isField ? fn.val : { raw: null, dn: null, vk: valueKind(kid(n, 'value')) };
    // page numbers in the body (Designer's "Page n of m"): xfa.layout.page(this) / pageCount(); page areas run their scripts per page
    const calc = isField && !fn.inPage ? deepText(kid(kid(n, 'calculate'), 'script')) : '';
    const dynamicPage = !!calc && usesLayout(calc);
    if (dynamicPage) {
      // its size with a two-digit page number; the value itself is painted on each page
      if (host && calcOf(n)) { const keep = pageNo; pageNo = { page: 99, pages: 99 }; host.run(fn, 'calculate'); raw = fn.val?.raw; pageNo = keep; }
      else raw = '99';
    }
    // a draw whose text a script set
    const scriptText = !isField && fn.val ? String(fn.val.raw ?? '') : null;
    // caption
    const cap = isField || n.tag === 'exclGroup' ? kid(n, 'caption') : null;
    let capLayout = null, capPlace = cap?.a.placement || 'left', capReserve = cap ? unit(cap.a.reserve, -1) : 0;
    if (cap && visible(cap)) {
      const cv = valueKind(kid(cap, 'value'));
      const cfont = fontOf(cap, font), cpara = paraOf(cap, { ...para, hAlign: 'left' });
      if (cv) capLayout = { paras: cv.tag === 'exData' ? richParas(exBody(cv), cfont, cpara, embedder(fn)) : [{ para: cpara, runs: [{ text: deepText(cv).trim(), font: cfont }] }], para: cpara };
    }
    // the content: text / rich text / graphic / image / barcode / check box
    let content;
    const multiLine = uiKind === 'textEdit' ? uiNode?.a.multiLine === '1' : true;
    if (!isField && vk && ['line', 'rectangle', 'arc'].includes(vk.tag)) content = { kind: vk.tag, node: vk };
    else if ((!isField && vk?.tag === 'image') || uiKind === 'imageEdit') content = { kind: 'image', node: isField ? (kid(kid(n, 'value'), 'image') || vk) : vk, data: dn };
    else if (uiKind === 'barcode') content = { kind: 'barcode', node: uiNode, value: displayOf(n, raw, vk) };
    else if (uiKind === 'checkButton') {
      // on: the first item (default 1); ABAP booleans (X, true) count as on when the on value is true / 1
      const on = deepText(kidsOf(n, 'items')[0]?.kids[0]).trim() || '1';
      const truthy = v => /^(x|true|1)$/i.test(String(v).trim());
      content = { kind: 'check', node: uiNode, checked: String(raw) === on || (truthy(on) && truthy(raw)) };
    }
    else if (uiKind === 'signature') content = { kind: 'signature' };
    else if (uiKind === 'button') content = { kind: 'none' };
    else if (scriptText !== null) content = { kind: 'text', paras: scriptText.split('\n').map(t => ({ para, runs: [{ text: t, font }] })) };
    else if (vk?.tag === 'exData' && !(isField && dn)) content = { kind: 'text', paras: richParas(exBody(vk), font, para, embedder(fn)) };
    else {
      const txt = isField ? displayOf(n, raw, vk) : vk ? displayOf(n, deepText(vk).trim(), vk) : '';
      content = { kind: 'text', paras: String(txt).split('\n').map((t, i, a) => ({ para, runs: [{ text: t, font }] })) };
    }
    // the extent: w / h, or growable (minW … maxW, minH … maxH)
    const fixedW = n.a.w !== undefined ? unit(n.a.w) : null, fixedH = n.a.h !== undefined ? unit(n.a.h) : null;
    const minW = unit(n.a.minW, 0), maxW = n.a.maxW ? unit(n.a.maxW) : Infinity, minH = unit(n.a.minH, 0), maxH = n.a.maxH ? unit(n.a.maxH) : Infinity;
    const capSide = capPlace === 'left' || capPlace === 'right';
    let capSize = 0;
    let capText = null;
    if (capLayout) {
      capText = layoutText(capLayout.paras, capSide ? (capReserve > 0 ? capReserve : Infinity) : Math.max(1, (fixedW ?? avail ?? 200) - m.l - m.r));
      capSize = capReserve >= 0 ? capReserve : capSide ? capText.w + 3 : capText.h;
    }
    const uiM = marginOf(uiNode || {});
    let W = fixedW, H = fixedH, textLayout = null;
    if (content.kind === 'text') {
      const innerW = W !== null ? Math.max(1, W - m.l - m.r - (capSide ? capSize : 0) - uiM.l - uiM.r) : (Number.isFinite(maxW) ? maxW - m.l - m.r : Infinity);
      textLayout = layoutText(content.paras, (isField && !multiLine) ? Infinity : innerW);
      if (W === null) W = Math.min(maxW, Math.max(minW, textLayout.w + m.l + m.r + uiM.l + uiM.r + (capSide ? capSize : 0)));
      if (H === null) H = Math.min(maxH, Math.max(minH, textLayout.h + m.t + m.b + uiM.t + uiM.b + (capSide ? 0 : capSize), capSide && capText ? capText.h + m.t + m.b : 0));
    }
    W ??= Math.max(minW, 0); H ??= Math.max(minH, 0);
    // a long text that grows with its content may be split over pages between its lines (not a fillable field)
    const splittable = content.kind === 'text' && fixedH === null && !(capSide && capText) && !dynamicPage && !willBeField(fn) && textLayout && textLayout.lines.length > 1;
    const textPart = (lines, first) => {
      const lh = lines.reduce((sum, l) => sum + l.h + (l.spaceAbove || 0) + (l.spaceBelow || 0), 0);
      const part = { lines, w: textLayout.w, h: lh };
      const ph = lh + m.t + m.b + uiM.t + uiM.b + (first && capText ? capSize : 0);
      return {
        w: W, h: ph,
        paint(x, y) {
          if (!shown(n)) return;
          mark(n, x, y, W, ph);
          drawBorder(border, x, y, W, ph);
          let cy = y + m.t;
          if (first && capText) { drawText(capText, x + m.l, cy, W - m.l - m.r, capSize, 'top'); cy += capSize; }
          drawText(part, x + m.l + uiM.l, cy + uiM.t, W - m.l - m.r - uiM.l - uiM.r, lh, 'top');
        },
        split: lines.length > 1 ? avail2 => splitLines(lines, avail2, false) : null,
      };
    };
    const splitLines = (lines, availH, first) => {
      let h = m.t + m.b + uiM.t + uiM.b + (first && capText ? capSize : 0), k = 0;
      while (k < lines.length && h + lines[k].h + (lines[k].spaceAbove || 0) + (lines[k].spaceBelow || 0) <= availH + 0.01) { h += lines[k].h + (lines[k].spaceAbove || 0) + (lines[k].spaceBelow || 0); k++; }
      if (k === 0 || k >= lines.length) return null;
      return [textPart(lines.slice(0, k), first), textPart(lines.slice(k), false)];
    };
    // a check box without a size: its box (default 10pt) next to its caption
    if (content.kind === 'check') {
      const sz = unit(uiNode?.a.size, 10);
      if (fixedW === null) W = Math.max(W, sz + 2 + m.l + m.r + uiM.l + uiM.r + (capSide ? capSize : 0));
      if (fixedH === null) H = Math.max(H, sz + m.t + m.b + uiM.t + uiM.b + (capSide ? 0 : capSize), capSide && capText ? capText.h + m.t + m.b : 0);
    }
    // fillable: an empty growable input field still gets room to type in
    if (fillable && isField && !fn.inPage && ['textEdit', 'numericEdit', 'dateTimeEdit', 'choiceList', 'passwordEdit'].includes(uiKind)) {
      const capW = capSide ? capSize : 0;
      if (fixedW === null && W - capW < 60) W = Math.min(maxW, Math.max(W, capW + Math.min(Number.isFinite(avail) && avail ? avail - capW : 140, 140)));
      if (fixedH === null) H = Math.min(maxH, Math.max(H, font.size * 1.25 + m.t + m.b + (capSide ? 0 : capSize)));
    }
    if (fillable && isField && uiKind === 'signature' && fixedH === null) H = Math.max(H, 28);
    const box = {
      w: W, h: H,
      ...(splittable ? { split: availH => splitLines(textLayout.lines, availH, true) } : {}),
      paint(x, y) {
        if (!shown(n)) return;
        mark(n, x, y, W, H);
        drawBorder(border, x, y, W, H);
        let cx = x + m.l, cy = y + m.t, cw = W - m.l - m.r, ch = H - m.t - m.b;
        if (capText) {
          const cpara = capLayout.para;
          if (capPlace === 'left') { drawText(capText, cx, cy, capSize, ch, cpara.vAlign); cx += capSize; cw -= capSize; }
          else if (capPlace === 'right') { drawText(capText, cx + cw - capSize, cy, capSize, ch, cpara.vAlign); cw -= capSize; }
          else if (capPlace === 'top') { drawText(capText, cx, cy, cw, capSize, 'top'); cy += capSize; ch -= capSize; }
          else if (capPlace === 'bottom') { drawText(capText, cx, cy + ch - capSize, cw, capSize, 'top'); ch -= capSize; }
        }
        if (content.kind !== 'check') drawBorder(borderOf(uiNode || {}), cx, cy, cw, ch);
        cx += uiM.l; cy += uiM.t; cw -= uiM.l + uiM.r; ch -= uiM.t + uiM.b;
        // interactive: open input fields become fillable PDF fields (AcroForm) named by their SOM expression
        if (willBeField(fn) && !rotated) {
          const tip = deepText(kid(kid(n, 'assist'), 'toolTip')).trim() || (capText ? capText.lines.map(l => l.segs.map(sg => sg.text).join('')).join(' ').trim() : '');
          const calculated = !!calcOf(n);
          const f = { name: somName(fn), x: cx, y: cy, w: Math.max(4, cw), h: Math.max(4, ch), required: kid(n, 'validate')?.a.nullTest === 'error', tooltip: tip,
            readOnly: /^(readOnly|protected|nonInteractive)$/.test(n.a.access || '') || (calculated && n.a.access !== 'open' && !kid(n, 'calculate')?.a.override),
            color: font.color && font.color.some(c => c) ? font.color : undefined, align: ['right', 'center'].includes(para.hAlign) ? para.hAlign : undefined };
          // the field in the form's font (embedded), not Helvetica
          const fref = fontRef(font);
          if (fref.ttf && !archive) f.font = fref.name;
          // its scripts (calculate, validate, change, exit, enter, click) as the field's JavaScript
          if (host && !archive) {
            const acts = host.acrobat(fn, x => (willBeField(x) ? somName(x) : null));
            if (Object.keys(acts).length) { f.actions = acts; pdf.docJs = ACROBAT_PRELUDE; }
          }
          const pic = kid(kid(n, 'format'), 'picture')?.text?.trim();
          if (uiKind === 'numericEdit' && pic && !archive && numberFormat(pic, n.a.locale && n.a.locale !== 'ambient' ? n.a.locale : locale)) {
            // the value as a number, shown with the display pattern (format action) so calculations can read it
            f.actions = { ...(f.actions || {}), format: numberFormat(pic, n.a.locale && n.a.locale !== 'ambient' ? n.a.locale : locale) };
            f.rawValue = raw === null || raw === undefined ? '' : String(raw);
            pdf.docJs = ACROBAT_PRELUDE;
          }
          if (uiKind === 'checkButton' && fn.parent?.tpl.tag === 'exclGroup') {
            // a radio button of its exclusion group
            const size = unit(uiNode.a.size, Math.min(cw, ch, 10));
            const onValue = deepText(kidsOf(n, 'items')[0]?.kids[0]).trim() || n.a.name || '1';
            Object.assign(f, { type: 'radio', group: somName(fn.parent), export: onValue, y: cy + (ch - size) / 2, w: size, h: size, value: content.checked });
          }
          else if (uiKind === 'checkButton') { const size = unit(uiNode.a.size, Math.min(cw, ch, 10)); Object.assign(f, { type: 'checkbox', y: cy + (ch - size) / 2, w: size, h: size, value: content.checked ? 'X' : '' }); }
          else if (uiKind === 'signature') f.type = 'signature';
          else if (uiKind === 'choiceList') { const lists = kidsOf(n, 'items'); const disp = lists.find(l => l.a.save !== '1') || lists[0]; Object.assign(f, { type: 'dropdown', options: (disp?.kids || []).map(k => deepText(k).trim()), value: displayOf(n, raw, vk) }); }
          else Object.assign(f, { type: uiNode?.a.multiLine === '1' ? 'multiline' : 'text', value: f.rawValue ?? displayOf(n, raw, vk), display: displayOf(n, raw, vk), size: Math.min(font.size, Math.max(4, ch * 0.8)) });
          const prev = pdf.page; pdf.page = page; pdf.field(f); pdf.page = prev;
          return;
        }
        switch (content.kind) {
          case 'text': {
            // a page number in the body ("Page n of m"): its script runs now, on the page it is painted on
            if (dynamicPage) {
              let v;
              if (host && calcOf(n)) { host.run(fn, 'calculate'); v = fn.val?.raw; }
              else v = String(/pageCount|sheetCount|absPageCount|numPages/.test(calc) ? pageNo.pages : pageNo.page);
              textLayout = layoutText(String(displayOf(n, v ?? '', vk)).split('\n').map(t => ({ para, runs: [{ text: t, font }] })), Number.isFinite(cw) ? cw : Infinity);
            }
            // a fixed size clips its text (as in Adobe); growable ones fit
            const clip = fixedW !== null && fixedH !== null && (textLayout.w > cw + 0.5 || textLayout.h > ch + 0.5);
            if (clip) ops(`q ${num(x)} ${num(y)} ${num(W)} ${num(H)} re W n`);
            drawText(textLayout, cx, cy, cw, ch, para.vAlign);
            if (clip) ops('Q');
            break;
          }
          case 'line': {
            const e = kid(content.node, 'edge'), c = colorOf(e) || [0, 0, 0], t = unit(e?.a.thickness, 0.5);
            const slope = content.node.a.slope === '/' ;
            if (e?.a.presence === 'hidden') break;
            ops(`q ${rgb(c)} RG ${num(t)} w ${DASH[e?.a.stroke] || ''} ${num(cx)} ${num(slope ? cy + ch : cy)} m ${num(cx + cw)} ${num(slope ? cy : cy + ch)} l S Q`);
            break;
          }
          case 'rectangle': {
            const e = kidsOf(content.node, 'edge')[0], f = kid(content.node, 'fill');
            const bb = { edges: [0, 1, 2, 3].map(() => (e && e.a.presence !== 'hidden' ? { w: unit(e.a.thickness, 0.5), color: colorOf(e) || [0, 0, 0], stroke: e.a.stroke || 'solid' } : null)), radius: unit(kid(content.node, 'corner')?.a.radius, 0), fill: f && f.a.presence !== 'hidden' ? colorOf(f) || [255, 255, 255] : null };
            if (!e) bb.edges = [0, 1, 2, 3].map(() => ({ w: 0.5, color: [0, 0, 0], stroke: 'solid' }));
            drawBorder(bb, cx, cy, cw, ch);
            break;
          }
          case 'arc': {
            const e = kid(content.node, 'edge'), c = colorOf(e) || [0, 0, 0], t = unit(e?.a.thickness, 0.5), f = kid(content.node, 'fill');
            const rx = cw / 2, ry = ch / 2, ccx = cx + rx, ccy = cy + ry, k = 0.5523;
            const p = `${num(ccx + rx)} ${num(ccy)} m ${num(ccx + rx)} ${num(ccy + ry * k)} ${num(ccx + rx * k)} ${num(ccy + ry)} ${num(ccx)} ${num(ccy + ry)} c ${num(ccx - rx * k)} ${num(ccy + ry)} ${num(ccx - rx)} ${num(ccy + ry * k)} ${num(ccx - rx)} ${num(ccy)} c ${num(ccx - rx)} ${num(ccy - ry * k)} ${num(ccx - rx * k)} ${num(ccy - ry)} ${num(ccx)} ${num(ccy - ry)} c ${num(ccx + rx * k)} ${num(ccy - ry)} ${num(ccx + rx)} ${num(ccy - ry * k)} ${num(ccx + rx)} ${num(ccy)} c h`;
            const fc = f && f.a.presence !== 'hidden' ? colorOf(f) : null;
            ops(`q ${fc ? `${rgb(fc)} rg ` : ''}${rgb(c)} RG ${num(t)} w ${p} ${fc ? 'B' : 'S'} Q`);
            break;
          }
          case 'image': { const b = imageBytes(content.node, content.data); if (b) drawImage(b, content.node?.a.contentType || content.data?.attrs.contentType, cx, cy, cw, ch, content.node?.a.aspect || 'fit'); break; }
          case 'barcode': {
            if (!content.value) break;
            const t = String(content.node.a.type || 'code128').toLowerCase();
            const type = /^qr/.test(t) ? 'qr' : /datamatrix/.test(t) ? 'datamatrix' : /pdf417/.test(t) ? 'pdf417' : /aztec/.test(t) ? 'aztec' : /code3of9|code39/.test(t) ? 'code39' : /code93/.test(t) ? 'code93' : /ean13/.test(t) ? 'ean13' : /ean8/.test(t) ? 'ean8' : /upca/.test(t) ? 'upca' : /2of5interleaved|itf/.test(t) ? 'itf' : /codabar/.test(t) ? 'codabar' : /ucc128|gs1|ean128/.test(t) ? 'gs1-128' : 'code128';
            let bc;
            try { bc = barcode(type, content.value, { level: ({ 0: 'L', 1: 'M', 2: 'Q', 3: 'H' })[content.node.a.errorCorrectionLevel] || 'M' }); } catch (e) { warn(`Barcode ${n.a.name || ''}: ${e.message}`); break; }
            if (bc.kind === 'matrix') {
              const rows = bc.rows ?? bc.modules, cols = bc.modules;
              const mw = unit(content.node.a.moduleWidth, 0);
              const mod = mw ? Math.min(mw, cw / cols, ch / rows) : Math.min(cw / cols, ch / rows);
              const ox = cx + (cw - mod * cols) / 2, oy = cy + (ch - mod * rows) / 2;
              ops(`q 0 g ${bc.dark.map(([a, b]) => `${num(ox + a * mod)} ${num(oy + b * mod)} ${num(mod + 0.02)} ${num(mod + 0.02)} re`).join(' ')} f Q`);
            } else {
              const textH = content.node.a.textLocation === 'none' ? 0 : Math.min(9, ch * 0.25);
              const mod = cw / bc.width;
              ops(`q 0 g ${bc.bars.map(b => `${num(cx + b.x * mod)} ${num(cy)} ${num(b.w * mod)} ${num(ch - textH)} re`).join(' ')} f Q`);
              if (textH) { const ref = fontRef({ typeface: 'Courier New', weight: 'normal', posture: 'normal' }); const s = bc.text || content.value; const tw = width(s, ref, textH * 0.9); ops(`BT /${ref.id} ${num(textH * 0.9)} Tf 0 g 1 0 0 -1 ${num(cx + (cw - tw) / 2)} ${num(cy + ch - 1)} Tm ${pdf.encode(s, ref.name)} Tj ET`); }
            }
            break;
          }
          case 'check': {
            const size = unit(content.node.a.size, Math.min(cw, ch, 10));
            const bx = cx, by = cy + (ch - size) / 2;
            const shape = content.node.a.shape === 'round';
            const own = borderOf(content.node);
            if (own) drawBorder(own, bx, by, size, size); else if (!shape) ops(`q 0 G 0.5 w ${num(bx)} ${num(by)} ${num(size)} ${num(size)} re S Q`);
            if (content.checked) ops(`q 0 G ${num(Math.max(0.6, size * 0.12))} w 1 J 1 j ${num(bx + size * 0.2)} ${num(by + size * 0.52)} m ${num(bx + size * 0.42)} ${num(by + size * 0.75)} l ${num(bx + size * 0.82)} ${num(by + size * 0.22)} l S Q`);
            break;
          }
        }
      },
    };
    return box;
  }
  // floating fields: #id of a (hidden) field of the template, formatted with its data; embedType som: a data reference
  const embedder = fn => (ref, type) => {
    if (type === 'som' || !/^#/.test(ref)) { const d = resolveRef(ref, fn.ctx, record).nodes[0]; return d ? d.text : ''; }
    const f = idMap.get(ref.slice(1));
    if (!f) return '';
    // the floating field's instance next to this one (its value may come from a script)
    let ff = null;
    for (let a = fn; a && !ff; a = a.parent) ff = findForm(a, f);
    if (ff?.val) return displayOf(ff.tpl, ff.val.raw, ff.val.vk);
    const { raw, vk } = fieldValue(f, fn.ctx);
    return displayOf(f, raw, vk);
  };
  // the SOM expression of a form node: form1[0].Sub[0].Field[0]
  const somName = fn => { const parts = []; for (let a = fn; a; a = a.parent) { const nm = a.tpl.a.name || `#${a.tpl.tag}`; const i = a.parent ? a.parent.kids.filter(k => (k.tpl.a.name || `#${k.tpl.tag}`) === nm).indexOf(a) : 0; parts.unshift(`${nm}[${i}]`); } return parts.join('.'); };
  const findForm = (fn, orig) => { if (fn.orig === orig) return fn; for (const k of fn.kids) { const r = findForm(k, orig); if (r) return r; } return null; };
  const exBody = vk => {
    // the exData's XHTML body (parsed again with its element structure)
    const findB = x => { for (const c of x.children || []) { if (c.type !== 'element') continue; if (/body$/i.test(c.name)) return c; const r = findB(c); if (r) return r; } return null; };
    return findB(vk.raw) || vk.raw;
  };

  // a container (subform / area / exclusion group) with its data context -> box (+ flow parts)
  function container(fn, avail) {
    const n = fn.tpl;
    const layout = n.a.layout || 'position';
    const m = marginOf(n);
    const border = borderOfNode(n);
    const fixedW = n.a.w !== undefined ? unit(n.a.w) : null, fixedH = n.a.h !== undefined ? unit(n.a.h) : null;
    const minH = unit(n.a.minH, 0), maxH = n.a.maxH ? unit(n.a.maxH) : Infinity, minW = unit(n.a.minW, 0);
    const innerAvail = (fixedW ?? avail ?? 612) - m.l - m.r;
    const kids = children(fn, layout === 'table' ? n : layout === 'row' ? n.$table || null : null, innerAvail);
    let W = fixedW, H = fixedH;
    const placed = [];
    if (layout === 'position') {
      let maxR = 0, maxB = 0;
      for (const k of kids) {
        const [px, py, bw, bh] = anchored(k.node, k.box);
        placed.push({ box: k.box, x: m.l + px, y: m.t + py, node: k.node, ax: m.l + unit(k.node.a.x, 0), ay: m.t + unit(k.node.a.y, 0), ox: k.node.$anchor?.ox || 0, oy: k.node.$anchor?.oy || 0 });
        maxR = Math.max(maxR, px + bw); maxB = Math.max(maxB, py + bh);
      }
      W ??= Math.max(minW, maxR + m.l + m.r);
      H ??= Math.min(maxH, Math.max(minH, maxB + m.t + m.b));
    } else if (layout === 'tb' || layout === 'table' || layout === 'row' || layout === 'lr-tb' || layout === 'rl-tb') {
      const cw = (W ?? avail ?? 612) - m.l - m.r;
      if (layout === 'tb' || layout === 'table') {
        let y = m.t, maxR = 0;
        for (const k of kids) {
          if (k.node.a.presence === 'hidden') continue;
          const ha = k.node.a.hAlign || n.a.hAlign;   // subforms in a flow: their own hAlign (center: centered)
          const dx = ha === 'center' ? (cw - k.box.w) / 2 : ha === 'right' ? cw - k.box.w : 0;
          placed.push({ box: k.box, x: m.l + Math.max(0, dx), y, node: k.node });
          y += k.box.h;
          maxR = Math.max(maxR, k.box.w);
        }
        W ??= Math.max(minW, maxR + m.l + m.r);
        H ??= Math.min(maxH, Math.max(minH, y + m.b));
      } else if (layout === 'row') {
        // a table row: the cells get the table's column widths
        const cols = colWidths(n.$table) || n.$cols || [];
        let x = m.l, i = 0, rowH = 0;
        const cells = [];
        for (const k of kids) {
          if (k.node.a.presence === 'hidden') continue;
          const span = Number(k.node.a.colSpan || 1);
          const w = span === -1 ? cols.slice(i).reduce((a, b) => a + b, 0) : cols.slice(i, i + span).reduce((a, b) => a + b, 0) || k.box.w;
          const box = k.relayout ? k.relayout(w) : k.box;
          cells.push({ box, x, w, node: k.node });
          x += w; i += span === -1 ? cols.length : span;
          rowH = Math.max(rowH, box.h);
        }
        for (const c of cells) {
          // cells of a row are as high as the row
          const box = c.box.h < rowH && c.node.$stretch ? c.node.$stretch(c.w, rowH) : c.box;
          placed.push({ box, x: c.x, y: m.t, node: c.node });
        }
        W ??= x + m.r; H ??= Math.max(minH, rowH + m.t + m.b);
      } else {
        // lr-tb / rl-tb: left to right, wrapping
        let x = 0, y = m.t, lineH = 0;
        const line = [];
        const flush = () => { for (const it of line) placed.push({ ...it, x: layout === 'rl-tb' ? m.l + cw - it.x - it.box.w : m.l + it.x, y }); y += lineH; x = 0; lineH = 0; line.length = 0; };
        for (const k of kids) {
          if (k.node.a.presence === 'hidden') continue;
          if (x > 0 && x + k.box.w > cw + 0.01) flush();
          line.push({ box: k.box, x, node: k.node });
          x += k.box.w; lineH = Math.max(lineH, k.box.h);
        }
        flush();
        W ??= Math.max(minW, (avail ?? cw + m.l + m.r)); H ??= Math.min(maxH, Math.max(minH, y + m.b));
      }
    }
    W ??= Math.max(minW, 0); H ??= minH;
    const box = {
      w: W, h: H, node: n,
      paint(x, y) {
        if (!shown(n)) return;
        mark(n, x, y, W, H);
        drawBorder(border, x, y, W, H);
        for (const p of placed) paintKid(p, x, y);
      },
    };
    // flowed containers without their own border or background can be split over pages between their children
    if ((layout === 'tb' || layout === 'table') && !border && fixedH === null && shown(n) && n.a.keepIntact !== 'contentArea' && kid(n, 'keep')?.a.intact !== 'contentArea')
      box.flow = { pad: [m.t, m.b], items: placed.map(p => ({ box: p.box, dx: p.x, node: p.node })), header: n.$header, trailer: n.$trailer, trailerDx: m.l };
    return box;
  }
  const paintKid = (p, x, y) => {
    const n = p.node, rot = Number(n?.a.rotate || 0) % 360;
    if (!rot) return p.box.paint(x + p.x, y + p.y);
    // rotated counter-clockwise around the anchor (x, y)
    const r = rot * Math.PI / 180, c = Math.cos(r), s = Math.sin(r);
    ops(`q ${num(c)} ${num(-s)} ${num(s)} ${num(c)} ${num(x + p.ax)} ${num(y + p.ay)} cm`);
    rotated++;
    try { p.box.paint(-p.ox, -p.oy); } finally { rotated--; }
    ops('Q');
  };
  // the position of a positioned child: x / y are its anchor; rotation turns it around the anchor
  function anchored(node, box) {
    const x = unit(node.a.x, 0), y = unit(node.a.y, 0);
    const at = node.a.anchorType || 'topLeft';
    const fx = /Center$/.test(at) ? 0.5 : /Right$/.test(at) ? 1 : 0, fy = /^middle/.test(at) ? 0.5 : /^bottom/.test(at) ? 1 : 0;
    const rot = Number(node.a.rotate || 0) % 360;
    if (!rot) return [x - fx * box.w, y - fy * box.h, box.w, box.h];
    // the extent after rotation (for the container's size); painting uses the anchor directly
    node.$anchor = { ox: fx * box.w, oy: fy * box.h };
    const w = rot === 90 || rot === 270 ? box.h : box.w, h = rot === 90 || rot === 270 ? box.w : box.h;
    return [rot === 180 ? x - box.w : rot === 270 ? x - box.h : x, rot === 90 ? y - box.w : rot === 180 ? y - box.h : y, w, h];
  }
  const colWidths = t => (t ? String(t.a.columnWidths || '').trim().split(/\s+/).filter(Boolean).map(v => unit(v)) : null);

  // the children of a container: instances of repeating subforms per data record, fields / draws
  function children(fn, table, avail) {
    const n = fn.tpl;
    const out = [];
    const cols = table ? colWidths(table) : null;
    for (const f of fn.kids) {
      const c = f.tpl;
      if (!visible(c) && c.a.presence !== 'invisible') continue;
      if (c.tag === 'field' || c.tag === 'draw') {
        const k = { node: c, box: leaf(f, avail) };
        if (table) { k.relayout = w => leaf(f, w, { w: `${w}pt` }); c.$stretch = (w, h) => leaf(f, w, { w: `${w}pt`, h: `${h}pt` }); }
        out.push(k);
        continue;
      }
      // subform / area / exclusion group instance
      if (cols) { c.$table = table; c.$cols = cols; }
      const k = { node: c, box: container(f, avail) };
      if (table && c.a.layout === 'row') k.relayout = null;
      out.push(k);
    }
    // overflow leader / trailer: <overflow leader="#id" trailer="#id"/> on the container or its rows (Designer's
    // pagination settings), or subforms named overflowLeader / overflowTrailer. The leader (a table's header row too)
    // is repeated on every page the content goes over; the trailer ends every page it continues from.
    const refOf = (attr) => { for (const x of [n, ...out.map(k => k.node)]) { const o = kid(x, 'overflow'); const v = o?.a[attr]; if (v) return String(v).replace(/^#/, ''); } return null; };
    const findRef = r => (r ? out.find(k => k.node.a.id === r || k.node.a.name === r || (r.includes('.') && k.node.a.name === r.split('.').pop())) : null);
    const leader = findRef(refOf('leader')) || out.find(k => k.node.a.name === 'overflowLeader' || kid(k.node, 'assist')?.a.role === 'TH' || kid(k.node, 'assist')?.a.role === 'THead');
    if (leader) n.$header = leader.box;
    const trailer = findRef(refOf('trailer')) || out.find(k => k.node.a.name === 'overflowTrailer');
    if (trailer) { n.$trailer = trailer.box; out.splice(out.indexOf(trailer), 1); }
    return out;
  }

  // the merged form: one node per instance (data binding and repetition), a copy of the template per instance
  const CONTENT = ['subform', 'area', 'exclGroup', 'field', 'draw', 'subformSet'];
  function merge(c, ctx, parent) {
    const fn = { tpl: { ...c, a: { ...c.a } }, orig: c, ctx, parent, kids: [], inPage: c.tag === 'pageArea' || !!parent?.inPage };
    if (c.tag === 'field') fn.val = fieldValue(c, ctx);
    else if (c.tag !== 'draw') mergeKids(fn, c, ctx);
    return fn;
  }
  function mergeKids(fn, n, ctx) {
    for (const c of n.kids) {
      if (!CONTENT.includes(c.tag)) continue;
      if (c.tag === 'subformSet') { mergeKids(fn, c, ctx); continue; }
      if (c.tag === 'field' || c.tag === 'draw') { fn.kids.push(merge(c, ctx, fn)); continue; }
      for (const inst of instances(c, ctx)) fn.kids.push(merge(c, inst, fn));
    }
  }

  // the data contexts of a subform: one per instance
  function instances(c, ctx) {
    const b = kid(c, 'bind'), occ = kid(c, 'occur');
    const min = occ?.a.min !== undefined ? Number(occ.a.min) : 1, max = occ?.a.max !== undefined ? Number(occ.a.max) : 1;
    const match = b?.a.match || 'once';
    let nodes = null;
    if (match === 'none') nodes = null;
    else if (match === 'dataRef' && b.a.ref) { const r = resolveRef(b.a.ref, ctx, record); nodes = r.nodes; if (!r.many && max === 1) nodes = nodes.slice(0, 1); }
    else if (match === 'global') nodes = c.a.name ? [findGlobal(record, c.a.name)].filter(Boolean) : null;
    else if (c.a.name && ctx) { const f = byName(ctx, c.a.name); nodes = f.length ? f : null; }
    const repeat = max !== 1;
    if (!nodes || !nodes.length) {
      // no data: the minimum number of instances (min 0: none), with the same context
      if (nodes && !nodes.length && repeat) return Array.from({ length: Math.max(0, min) }, () => ctx);
      if (!nodes && repeat && match !== 'none' && c.a.name) return Array.from({ length: Math.max(0, min) }, () => ctx);
      return min === 0 && match === 'dataRef' ? [] : [ctx];
    }
    // a wrapper of rows (FDP: <_Visits><Visits/>…</_Visits>) bound by a repeating subform: its rows
    if (repeat && nodes.length === 1 && nodes[0].kids.length && nodes[0].kids.every(k => k.name === nodes[0].kids[0].name && k.kids.length) && !nodes[0].text.trim()) nodes = nodes[0].kids;
    const list = repeat ? nodes.slice(0, max < 0 ? undefined : max) : nodes.slice(0, 1);
    while (list.length < min) list.push(ctx);
    return list;
  }

  // ---------------------------------------------------------------- pages
  const pageSet = kid(root, 'pageSet');
  const areas = pageSet ? collectPageAreas(pageSet) : [];
  if (!areas.length) areas.push({ a: { name: 'Page1' }, kids: [], tag: 'pageArea', parent: null });
  const pageSize = pa => {
    const med = kid(pa, 'medium');
    let w = unit(med?.a.short, 612), h = unit(med?.a.long, 792);
    if (med?.a.orientation === 'landscape') [w, h] = [h, w];
    const ca = kid(pa, 'contentArea');
    return { w, h, ca: ca ? { x: unit(ca.a.x), y: unit(ca.a.y), w: unit(ca.a.w, w), h: unit(ca.a.h, h) } : { x: 36, y: 36, w: w - 72, h: h - 72 } };
  };
  const pages = [];
  const newPage = (paIndex) => {
    const pa = areas[Math.min(paIndex, areas.length - 1)];
    const sz = pageSize(pa);
    pdf.addPage(sz.w, sz.h);
    page = pdf.page;
    ops(`1 0 0 -1 0 ${num(sz.h)} cm`);
    const pg = { pa, sz, page, y: sz.ca.y, items: [] };
    pages.push(pg);
    return pg;
  };
  const nextAreaIndex = () => {
    const i = pages.length;
    // a page area occurs once (occur max 1) unless it repeats; then the next one
    let k = 0, used = 0;
    for (; k < areas.length; k++) { const max = Number(kid(areas[k], 'occur')?.a.max ?? -1); if (max < 0) return k; used += max; if (i < used) return k; }
    return areas.length - 1;
  };

  // the content: the root subform's children (flowed: paginated; positioned: on the first page)
  const rootCtx = record && (record.name === root.a.name || !root.a.name) ? record : (byName(record, root.a.name)[0] || record);
  pageNo = { page: 1, pages: 1 };
  const rootFn = merge(root, rootCtx, null);
  // scripts (JavaScript, FormCalc): initialize, calculate, validate, ready, prePrint before the layout
  const scripted = (function any(n) { return n.tag === 'script' || n.kids.some(any); })(tpl);
  // the geometry of the first layout pass: the boxes of a form node by template path and its place among those nodes
  let geometry = null;
  if (geometryPass) {
    const byPath = new Map();
    for (const b of geometryPass.boxes) { if (!byPath.has(b.path)) byPath.set(b.path, []); byPath.get(b.path).push(b); }
    const order = new Map();
    (function walk(fn) { const p = fn.tpl.$path; if (p !== undefined) { if (!order.has(p)) order.set(p, []); order.get(p).push(fn); } (fn.kids || []).forEach(walk); })(rootFn);
    const of = fn => {
      const list = byPath.get(fn.tpl.$path);
      if (list) { const i = (order.get(fn.tpl.$path) || []).indexOf(fn); const b = list[Math.max(0, i)] || list[0]; return b ? [b] : null; }
      // a container split over pages has no box of its own: per page, the extent of what it holds
      const pre = `${fn.tpl.$path}/`, per = new Map();
      for (const b of geometryPass.boxes) if (b.path.startsWith(pre)) { const e = per.get(b.page) || { page: b.page, x: b.x, y: b.y, r: b.x + b.w, bt: b.y + b.h }; e.x = Math.min(e.x, b.x); e.y = Math.min(e.y, b.y); e.r = Math.max(e.r, b.x + b.w); e.bt = Math.max(e.bt, b.y + b.h); per.set(b.page, e); }
      return per.size ? [...per.values()].sort((a, b) => a.page - b.page).map(e => ({ page: e.page, x: e.x, y: e.y, w: e.r - e.x, h: e.bt - e.y })) : null;
    };
    geometry = { of, *byPage(i) { for (const fns of order.values()) for (const fn of fns) { const b = of(fn); if (b && b[0].page === i) yield fn; } } };
    pageNo = { page: 1, pages: geometryPass.pages.length };
  }
  const host = scripted ? createScriptHost({ root: rootFn, record, locale, warn, display: f => displayOf(f.tpl, f.val?.raw ?? '', f.val?.vk), merge: (c, ctx, parent) => merge(c, ctx, parent), page: () => pageNo, geometry }) : null;
  if (host) host.prepare(rootFn);
  let pg = newPage(0);
  const rootLayout = rootFn.tpl.a.layout || 'position';
  const items = children(rootFn, null, pg.sz.ca.w);
  const flowItems = [];
  const expand = (list, dx) => { for (const it of list) flowItems.push({ ...it, dx: (it.dx || 0) + dx }); };
  if (rootLayout === 'position') {
    for (const k of items) { const [px, py] = anchored(k.node, k.box); pg.items.push({ box: k.box, x: pg.sz.ca.x + px, y: pg.sz.ca.y + py, node: k.node }); }
  } else {
    expand(items.map(k => ({ box: k.box, node: k.node, dx: 0 })), 0);
    const place = (list, dx) => {
      for (const it of list) {
        const n = it.node;
        const bb = kid(n, 'breakBefore') || kid(n, 'break');
        if ((bb?.a.targetType === 'pageArea' || bb?.a.before === 'pageArea' || bb?.a.targetType === 'contentArea' || bb?.a.before === 'contentArea') && pg.y > pg.sz.ca.y + 0.01) {
          const t = String(bb.a.target || '').replace(/^#/, '');
          const idx = t ? areas.findIndex(a => a.a.id === t || a.a.name === t) : -1;
          pg = newPage(idx >= 0 ? idx : nextAreaIndex());
        }
        const bottom = pg.sz.ca.y + pg.sz.ca.h;
        const ha = n?.a.hAlign;
        const cx = pg.sz.ca.x + dx + (it.dx || 0) + (dx === 0 && !it.dx && ha === 'center' ? (pg.sz.ca.w - it.box.w) / 2 : 0);
        if (pg.y + it.box.h <= bottom + 0.01 || (pg.y <= pg.sz.ca.y + 0.01 && !it.box.flow && !(it.box.split && it.box.split(bottom - pg.y)))) {
          pg.items.push({ box: it.box, x: cx, y: pg.y, node: n });
          pg.y += it.box.h;
        } else if (it.box.flow) {
          // split between its children; a table's header row again on the next page
          pg.y += it.box.flow.pad[0];
          const sub = it.box.flow.items;
          const header = it.box.flow.header, trailer = it.box.flow.trailer;
          const startPage = pg;
          for (const [si, s] of sub.entries()) {
            const before = pg;
            // the overflow trailer ("continued …") at the bottom of a page the content goes on from
            if (trailer && si < sub.length - 1 && pg.y > pg.sz.ca.y + 0.01 && pg.y + s.box.h + trailer.h > pg.sz.ca.y + pg.sz.ca.h + 0.01) {
              pg.items.push({ box: trailer, x: cx + (it.box.flow.trailerDx || 0), y: pg.y, node: null });
              pg = newPage(nextAreaIndex());
            }
            place([{ ...s, dx: 0 }], cx - pg.sz.ca.x + s.dx);
            if (pg !== before && header && s.box !== header && pg !== startPage) {
              // the header was not repeated yet on this page: put it before the row that moved
              const last = pg.items.pop();
              pg.y -= last.box.h;
              pg.items.push({ box: header, x: last.x - s.dx + (sub.find(z => z.box === header)?.dx || 0), y: pg.y, node: null });
              pg.y += header.h;
              pg.items.push({ ...last, y: pg.y });
              pg.y += last.box.h;
            }
          }
          pg.y += it.box.flow.pad[1];
        } else if (it.box.split && bottom - pg.y >= 18 && it.box.split(bottom - pg.y)) {
          // a long text: the lines that fit here, the rest on the next page (split again when needed)
          const [here, rest] = it.box.split(bottom - pg.y);
          pg.items.push({ box: here, x: cx, y: pg.y, node: n });
          pg.y += here.h;
          pg = newPage(nextAreaIndex());
          place([{ ...it, box: rest, dx: it.dx }], dx);
          continue;
        } else {
          pg = newPage(nextAreaIndex());
          pg.items.push({ box: it.box, x: cx, y: pg.y, node: n });
          pg.y += it.box.h;
        }
        const ba = kid(n, 'breakAfter') || kid(n, 'break');
        if (ba?.a.targetType === 'pageArea' || ba?.a.after === 'pageArea') pg = newPage(nextAreaIndex());
      }
    };
    place(flowItems, 0);
  }
  // paint: master page content (page numbers known now), then the content
  const total = pages.length;
  for (const [i, p] of pages.entries()) {
    page = p.page;
    pageIndex = i;
    pageNo = { page: i + 1, pages: total };
    const paFn = merge(p.pa, rootCtx, rootFn);
    if (host) host.preparePage(paFn);
    for (const k of children(paFn, null, p.sz.w)) {
      const [px, py] = anchored(k.node, k.box);
      paintKid({ box: k.box, x: px, y: py, node: k.node, ax: unit(k.node.a.x, 0), ay: unit(k.node.a.y, 0), ox: k.node.$anchor?.ox || 0, oy: k.node.$anchor?.oy || 0 }, 0, 0);
    }
    for (const it of p.items) {
      if (it.node?.a.rotate) paintKid({ ...it, x: it.x, y: it.y, ax: unit(it.node.a.x, 0), ay: unit(it.node.a.y, 0), ox: it.node.$anchor?.ox || 0, oy: it.node.$anchor?.oy || 0 }, 0, 0);
      else it.box.paint(it.x, it.y);
    }
  }
  const out = pdf.render({ ...(archive ? { pdfa: true } : {}), ...(security && !archive ? { encrypt: security } : {}) });
  const layoutInfo = boxes ? { boxes, root: rootFn.tpl.$path, pages: pages.map(p => ({ w: p.sz.w, h: p.sz.h, pageArea: p.pa.$path, contentArea: { ...p.sz.ca, path: kid(p.pa, 'contentArea')?.$path } })) } : undefined;
  const fields = pdf.fields.map(f => ({ name: f.name, type: f.type, value: f.value, display: f.display, readOnly: !!f.readOnly, group: f.group, export: f.export, actions: f.actions || (f.js ? { calculate: f.js } : undefined) }));
  return { pdf: out, pages: total, warnings, text: pages.map(p => p.page.$text || []), layout: layoutInfo, fields, docJs: pdf.docJs || null };
}
let pageNo = { page: 1, pages: 1 };

function collectPageAreas(ps) {
  const out = [];
  for (const k of ps.kids) { if (k.tag === 'pageArea') out.push(k); else if (k.tag === 'pageSet') out.push(...collectPageAreas(k)); }
  return out;
}
const fontFiles = new Map();
function readFontFile(f) { if (!fontFiles.has(f)) fontFiles.set(f, fs.readFileSync(f)); return fontFiles.get(f); }
// an element of parseXml's tree as XML text (for an exData's XHTML)
function serialize(x) {
  if (x.type === 'text') return String(x.value).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const attrs = (x.attrs || []).map(a => ` ${a.name}="${String(a.value).replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"`).join('');
  return `<${x.name}${attrs}>${(x.children || []).map(serialize).join('')}</${x.name}>`;
}
function serializeNode(n) {
  const attrs = Object.entries(n.a).map(([k, v]) => ` ${k}="${String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"`).join('');
  return `<${n.tag}${attrs}>${n.text ? n.text.replace(/&/g, '&amp;').replace(/</g, '&lt;') : ''}${n.kids.map(serializeNode).join('')}</${n.tag}>`;
}
