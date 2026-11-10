// Print form engine (the counterpart of Adobe Document Services): a form layout (src/<name>.form.json) merged with
// data and drawn as PDF. The same engine serves the ABAP runtime (cl_fp_ads_util, FP_JOB_OPEN / generated function
// modules, zcl_rap_form, cl_fp pdf objects) and the classic engine.
//
// Layout
//   { "title", "locale": "en_US", "dataProvider": "ZFDP_...",   (a service definition, see cl_fp_fdp_services)
//     "page": { "size": "A4" | "A5" | "Letter" | [w, h], "orientation": "portrait" | "landscape",
//               "margin": 40 | "15mm" | { "top", "right", "bottom", "left" } },
//     "fonts": { "corp": "OpenSans.ttf", "corp-bold": "OpenSans-Bold.ttf" }, "font": "corp",   (TrueType fonts from
//               src/, embedded as a subset: any script; "-bold" / "-italic" / "-bolditalic" variants)
//     "variables": { "net": "Sum(_item.amount)", "tax": "Round(net * 0.19, 2)" },   (calculated once, in order,
//               usable like data fields; the expression language is described in script.js)
//     "interactive": true,   (input fields are fillable; false: printed as text)
//     "styles": { "name": { "size", "bold", "italic", "color", "align", "mono", "font" } },
//     "texts": { "name": { "en": "…", "de": "…" } },          (text modules, by language)
//     "watermark": "DRAFT" | { "text": "COPY", "if": "{copy}" },
//     "pdfa": true,   (PDF/A-2b for archiving: fonts embedded, sRGB output intent, XMP metadata; no JavaScript)
//     "security": { "userPassword": "…" (to open), "ownerPassword": "…", "permissions": ["print", "fill", "copy", …] },
//               (AES-256 encryption; permissions: print, printHigh, modify, copy, annotate, fill, accessibility, assemble)
//     "sample": { preview data },
//     "firstHeader": [items], "header": [items], "footer": [items], "content": [items] }   (master page: header and
//     footer on every page, firstHeader on page 1 instead of the header)
// Items (every item may have "if": "<expression>", "style", "keepTogether": true, "pageBreakBefore": true)
//   { "text": "Invoice {id} for **{customer}**", "size", "bold", "italic", "color", "align", "mono" }   (**bold** inline)
//   { "textModule": "terms" }                                   a text of "texts" in the form's language
//   { "fields": [["Label", "{field}"], ["Date", "{date}", "date"]], "size" }
//   { "table": "items", "columns": [{ "title", "field", "value": "{a} {b}", "calc": "quantity * price", "width",
//     "align", "format", "if", "wrap": true }], "total": { "field": "sum" | "avg" | "count" | "min" | "max" },
//     "totalLabel", "groupBy": "field", "groupHeader": "Group {field}", "subtotal": true, "stripes": true,
//     "headerColor", "size" }   (the header repeats on every page; long cell texts wrap; "calc" adds a column)
//   { "image": "logo.png" | "{field}", "width", "height", "align" }   (PNG / JPEG from src/ or data as hex / base64)
//   { "barcode": "qr" | "code128" | "ean13" | "code39" | "code93" | "ean8" | "upca" | "upce" | "itf" | "itf14" | "codabar" |
//     "gs1-128" | "datamatrix" | "gs1datamatrix" | "pdf417" | "aztec" | "maxicode" | …, "value": "{field}", "size" (square
//     2D codes), "width", "height" (linear codes, PDF417), "text": true, "align", "level": "M" (QR) }
//   { "columns": [{ "width": 1, "items": [...] }, ...], "gap": 12 }     side by side
//   { "box": [items], "x", "y", "width", "height", "border", "fill", "padding" }   placed at a position on the page
//   { "repeat": "items", "items": [...] }                      the items once per line of a table (a repeating subform)
//   { "input": "remark", "label": "Remarks", "type": "text" | "multiline" | "checkbox" | "dropdown" | "signature",
//     "value": "{remark}", "options": ["A", "B"], "width", "height", "required", "readOnly", "maxLength" }
//     a fillable field (interactive forms); its value comes back with cl_fp pdf objects (extract data);
//     "calc": "quantity * price" (expression over the data and fillable fields before it): its value, recalculated in
//     Acrobat / Reader while the form is filled
//   { "line": true, "color" } | { "space": 12 } | { "pagebreak": true }
// Values: {field}, {struct-field}, {sy-datum}, {page}, {pages}; formats {x:date} {x:time} {x:amount} {x:number}
//   {x:currency:EUR} or {x:currency:{waers}} {x:upper}; numbers and dates follow the form's locale.
//   Calculations: {= net * 1.19 :amount}, {= if paid then 'Paid' else 'Open' endif}, {= WordNum(total)}.
// Conditions: expressions (script.js): status = 'X', {amount} > 1000, flag, not flag, … and … / … or …, ( … ).
// Sizes: points, or "mm" / "cm" / "in".
// renderForm returns { pdf, pages, fields, warnings, text }: warnings name unknown data fields, characters the fonts
// cannot show, missing images and unknown items, for checking a layout; text is the text of each page.
import fs from 'node:fs';
import path from 'node:path';
import { Pdf, readImage } from './pdf.js';
import { barcode } from './barcode.js';
import { evaluate, resolve, truthy, toAcrobatJs } from './script.js';
import { signPdf } from './sign.js';
import { pdfaFonts } from './pdfa.js';

const SIZES = { A4: [595.28, 841.89], A5: [419.53, 595.28], A3: [841.89, 1190.55], LETTER: [612, 792], LEGAL: [612, 1008] };
const len = v => { if (typeof v === 'number') return v; const m = /^\s*([\d.]+)\s*(mm|cm|in|pt)?\s*$/.exec(String(v ?? '')); if (!m) return 0; const n = Number(m[1]); return m[2] === 'mm' ? n * 72 / 25.4 : m[2] === 'cm' ? n * 72 / 2.54 : m[2] === 'in' ? n * 72 : n; };
const rgb = c => { const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(c || ''); return m ? m.slice(1).map(h => parseInt(h, 16)) : null; };
const lang = locale => String(locale || 'en').slice(0, 2).toLowerCase();

export function lookup(data, name) {
  const v = resolve(data, name);
  return v ?? '';
}
// whether a data path exists (for the warnings of a layout)
function known(data, name) {
  let cur = data;
  for (const part of String(name).toLowerCase().split(/[-.]/)) {
    if (Array.isArray(cur)) cur = cur[0];
    if (cur == null || typeof cur !== 'object') return false;
    if (!(part in cur) && !(part.toUpperCase() in cur)) return false;
    cur = cur[part] ?? cur[part.toUpperCase()];
  }
  return true;
}
const BUILTIN = /^(sy|page|pages|index)([-.]|$)/i;
// a value in the form's locale
export function format(v, kind, locale = 'en_US', arg) {
  if (v === null || v === undefined || v === '') return '';
  if (Array.isArray(v)) return v.map(x => format(x, kind, locale, arg)).join(', ');
  if (typeof v === 'boolean') v = v ? 'X' : '';
  const loc = String(locale).replace('_', '-');
  const n = Number(v);
  switch (kind) {
    case 'date': { const s = String(v); if (!/^\d{8}$/.test(s) || s === '00000000') return s === '00000000' ? '' : s; return new Intl.DateTimeFormat(loc, { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'UTC' }).format(Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8))); }
    case 'time': { const s = String(v); return /^\d{6}$/.test(s) ? `${s.slice(0, 2)}:${s.slice(2, 4)}:${s.slice(4, 6)}` : s; }
    case 'amount': return Number.isFinite(n) ? n.toLocaleString(loc, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : String(v);
    case 'number': return Number.isFinite(n) ? n.toLocaleString(loc, { maximumFractionDigits: 3 }) : String(v);
    case 'integer': return Number.isFinite(n) ? Math.round(n).toLocaleString(loc) : String(v);
    case 'currency': { if (!Number.isFinite(n)) return String(v); const dec = ['JPY', 'KRW', 'HUF', 'CLP', 'ISK', 'VND'].includes(String(arg).toUpperCase()) ? 0 : 2; return `${n.toLocaleString(loc, { minimumFractionDigits: dec, maximumFractionDigits: dec })}${arg ? ` ${String(arg).toUpperCase()}` : ''}`; }
    case 'upper': return String(v).toUpperCase();
    case 'lower': return String(v).toLowerCase();
    case 'alpha': return String(v).replace(/^0+(?=.)/, '');   // ALPHA = OUT: no leading zeros
    default: return typeof v === 'number' && !Number.isInteger(v) ? Number(v.toPrecision(15)).toString() : String(v);
  }
}
const FORMATS = 'date|time|amount|number|integer|currency|upper|lower|alpha';
const PLACEHOLDER = new RegExp(`\\{=((?:[^{}'"]|'[^']*'|"[^"]*"|\\{[\\w./-]+\\})*?)(?::(${FORMATS})(?::(\\{[\\w./-]+\\}|[\\w-]+))?)?\\s*\\}|\\{([\\w./-]+)(?::(\\w+)(?::(\\{[\\w./-]+\\}|[\\w-]+))?)?\\}`, 'g');
// {field[:format[:arg]]} and {= expression [:format[:arg]]} in a text; arg may itself be {field}
export function fill(tpl, data, locale, warn) {
  return String(tpl ?? '').replace(PLACEHOLDER, (all, expr, ekind, earg, name, kind, arg) => {
    const a = (x => (x?.startsWith('{') ? lookup(data, x.slice(1, -1)) : x))(expr !== undefined ? earg : arg);
    if (expr !== undefined) {
      try { return format(evaluate(expr, data, { format: (v, k, x) => format(v, k, locale, x) }), ekind, locale, a); }
      catch (e) { warn?.(`${e.message} (in ${all})`); return ''; }
    }
    if (warn && !BUILTIN.test(name) && !known(data, name)) warn(`Unknown field {${name}}`);
    return format(lookup(data, name), kind, locale, a);
  });
}
// conditions: expressions (script.js) that are true or not
export function condition(expr, data, warn) {
  if (expr === undefined || expr === null || expr === true) return true;
  if (expr === false) return false;
  try { return truthy(evaluate(String(expr), data)); }
  catch (e) { if (warn) { warn(`${e.message} (condition "${expr}")`); return false; } throw e; }
}

const STD = { helvetica: ['Helvetica', 'Helvetica-Bold', 'Helvetica-Oblique', 'Helvetica-BoldOblique'], times: ['Times-Roman', 'Times-Bold', 'Times-Roman', 'Times-Bold'], courier: ['Courier', 'Courier-Bold', 'Courier', 'Courier-Bold'] };
const ITEMS = ['text', 'textModule', 'fields', 'table', 'repeat', 'image', 'barcode', 'columns', 'box', 'input', 'line', 'space', 'pagebreak'];

// the form + data -> a PDF (Buffer); options: { locale, assets: name => Buffer | null, fillable, signature: { key,
// cert, field, reason, location, name } }
// design: true also returns the layout for the visual designer: the pages' drawing operations and where every item
// of the layout landed ({ path: 'content.3.columns.1.items.0', page, x, y, w, h })
export function renderForm(form, data = {}, { locale, assets, fillable, signature, design, pdfa, security } = {}) {
  const loc = locale || form.locale || 'en_US';
  const warnings = new Set();
  const warn = m => warnings.add(m);
  const interactive = fillable ?? form.interactive ?? true;
  let [W, H] = Array.isArray(form.page?.size) ? form.page.size.map(len) : SIZES[String(form.page?.size || 'A4').toUpperCase()] || SIZES.A4;
  if (form.page?.orientation === 'landscape' && W < H) [W, H] = [H, W];
  const mg = form.page?.margin ?? 40;
  const M = typeof mg === 'object' ? { top: len(mg.top ?? 40), right: len(mg.right ?? 40), bottom: len(mg.bottom ?? 40), left: len(mg.left ?? 40) } : { top: len(mg), right: len(mg), bottom: len(mg), left: len(mg) };
  const styles = form.styles || {};
  const pdf = new Pdf({});
  // PDF/A: the standard fonts are replaced by an embedded font (metrically compatible with Helvetica)
  const archive = pdfa ?? form.pdfa === true;
  if (archive) {
    const f = pdfaFonts();
    if (!f) warn('PDF/A needs the font package @expo-google-fonts/arimo (npm install)');
    else { pdf.addFont('pdfa-sans', f.regular); pdf.addFont('pdfa-sans-bold', f.bold); pdf.addFont('pdfa-sans-italic', f.italic); pdf.addFont('pdfa-sans-bolditalic', f.bolditalic); pdf.fieldFont = 'pdfa-sans'; }
    if (security ?? form.security) warn('A PDF/A document cannot be encrypted: the security settings are not used');
  }
  const archived = font => (!archive || pdf.fonts.has(font) || !pdf.fieldFont ? font : `pdfa-sans${/Bold/.test(font) && /Oblique|Italic/.test(font) ? '-bolditalic' : /Bold/.test(font) ? '-bold' : /Oblique|Italic/.test(font) ? '-italic' : ''}`);
  for (const [name, file] of Object.entries(form.fonts || {})) {
    const buf = assets?.(file);
    if (!buf) { warn(`Font ${file} not found (put the .ttf file into the app's src folder)`); continue; }
    try { pdf.addFont(name, buf); } catch (e) { warn(`Font ${file}: ${e.message}`); }
  }
  const fontOf = (st, bold, italic) => {
    const fam = st.mono ? 'courier' : st.font || form.font || 'helvetica';
    if (pdf.fonts.has(fam)) {
      const v = [bold && italic && `${fam}-bolditalic`, bold && `${fam}-bold`, italic && `${fam}-italic`].find(n => n && pdf.fonts.has(n));
      return v || fam;
    }
    const std = STD[String(fam).toLowerCase()];
    if (!std) warn(`Unknown font ${fam} (define it under "fonts" or use helvetica, times, courier)`);
    return archived((std || STD.helvetica)[(bold ? 1 : 0) + (italic ? 2 : 0)]);
  };
  const tw = (t, f, size) => pdf.textWidth(t, f, size);
  const checkGlyphs = (t, f) => { const miss = pdf.missing(t, f); if (miss.length) warn(`The font ${f} cannot show ${miss.slice(0, 8).join(' ')}${pdf.fonts.has(f) ? '' : ' (add a TrueType font: "fonts" and "font")'}`); };
  // calculated table columns ("calc") become fields of the lines first: totals, variables and conditions see them
  data = { ...data };
  const tables = [];
  const walk = list => { for (const it of list || []) { if (!it || typeof it !== 'object') continue; if (it.table && (it.columns || []).some(c => c.calc)) tables.push(it); walk(it.items); walk(it.box); for (const c of it.columns || []) walk(c.items); } };
  walk(form.content);
  for (const t of tables) {
    const rows = resolve(data, t.table);
    if (!Array.isArray(rows) || String(t.table).includes('.')) continue;
    data[String(t.table).toLowerCase()] = rows.map((row, k) => {
      const r = { ...row };
      for (const c of t.columns.filter(c => c.calc)) {
        const key = String(c.field || c.title || 'calc').toLowerCase();
        try { r[key] = evaluate(String(c.calc), { ...data, ...r, index: k + 1 }); } catch (e) { warn(`Column ${c.title || key}: ${e.message}`); r[key] = ''; }
      }
      return r;
    });
  }
  // form variables: calculated in order, then usable like data
  for (const [name, expr] of Object.entries(form.variables || {})) {
    try { data[name.toLowerCase()] = evaluate(String(expr), data, { format: (v, k, x) => format(v, k, loc, x) }); }
    catch (e) { warn(`Variable ${name}: ${e.message}`); data[name.toLowerCase()] = ''; }
  }
  const fillT = (t, ctx) => fill(t, ctx, loc, warn);
  const cond = (e, ctx) => condition(e, ctx, warn);
  const imageCache = new Map();
  const loadImage = (ref, ctx) => {
    let key = String(ref || ''), buf = null;
    if (/^\{[\w./-]+\}$/.test(key)) {
      const v = String(lookup(ctx, key.slice(1, -1)) || '');
      if (!v) return null;
      buf = /^([0-9A-Fa-f]{2})+$/.test(v) ? Buffer.from(v, 'hex') : Buffer.from(v.replace(/^data:[^,]*,/, ''), 'base64');
      key = `data:${v.length}:${v.slice(0, 32)}`;
    }
    if (imageCache.has(key)) return imageCache.get(key);
    if (!buf) buf = assets?.(key);
    if (!buf) { warn(`Image ${key} not found (put it into the app's src folder)`); imageCache.set(key, null); return null; }
    let img = null;
    try { img = readImage(buf); if (design) img.src = buf; } catch (e) { warn(`Image ${key}: ${e.message}`); }
    imageCache.set(key, img);
    return img;
  };

  // layout into pages of drawing operations; header / footer are drawn afterwards (they know {page} and {pages})
  let ops = [], y = 0;
  const state = { noBreak: false, measuring: false };
  const boxes = [];
  let pageNo = 0;
  let headerH = 0, footerH = 0, top = M.top, bottom = H - M.bottom;   // set once the helpers below exist
  const pages = [];
  const newPage = () => { ops = []; pages.push(ops); pageNo = pages.length - 1; y = top; };
  const names = new Set();
  const inputValues = {};   // fillable fields drawn so far (for calculations)

  function measure(it, ctx, width) {   // the height of an item (a dry run)
    const savedOps = ops, savedY = y;
    ops = []; y = 0;
    const saveBreak = state.noBreak, saveMeasuring = state.measuring; state.noBreak = true; state.measuring = true;
    try { item(it, ctx, M.left, width); return y; } finally { ops = savedOps; y = savedY; state.noBreak = saveBreak; state.measuring = saveMeasuring; }
  }
  const ensure = h => { if (!state.noBreak && y + h > bottom && y > top) newPage(); };
  const style = it => ({ ...(it.style ? styles[it.style] || (warn(`Unknown style ${it.style}`), {}) : {}), ...it });
  const textOp = (x, yy, text, rawFont, size, color) => { const font = archived(rawFont); checkGlyphs(text, font); ops.push({ op: 'text', x, y: yy, text, font, size, color, ...(design ? { w: tw(text, font, size) } : {}) }); };
  // lines of a text in a width (words; a word longer than the width is broken)
  const wrap = (text, font, size, width) => {
    const out = [];
    for (const para of String(text).split('\n')) {
      let line = '';
      for (const w of para.split(/(\s+)/)) {
        if (!w) continue;
        if (line && tw(line + w, font, size) > width && w.trim()) { out.push(line.trimEnd()); line = ''; if (!w.trim()) continue; }
        let word = line ? w : w.trimStart();
        while (tw(word, font, size) > width && word.length > 1) { let k = word.length - 1; while (k > 1 && tw(word.slice(0, k), font, size) > width) k--; out.push(word.slice(0, k)); word = word.slice(k); }
        line += word;
      }
      out.push(line.trimEnd());
    }
    return out;
  };

  // a text with **bold** runs, wrapped to the width
  function textBlock(raw, ctx, x, width, it) {
    const st = style(it);
    const size = Number(st.size || 10), lineH = size * (st.lineHeight || 1.35);
    const runs = [];
    String(fillT(raw, ctx)).split(/(\*\*[^*]+\*\*)/).forEach(part => { if (part) runs.push(part.startsWith('**') ? { t: part.slice(2, -2), bold: true } : { t: part, bold: !!st.bold }); });
    const words = [];
    for (const r of runs) for (const [k, para] of r.t.split('\n').entries()) {
      if (k) words.push({ br: true });
      for (const w of para.split(/(\s+)/)) if (w) words.push({ t: w, bold: r.bold });
    }
    const lines = [[]];
    let lw = 0;
    for (const w of words) {
      if (w.br) { lines.push([]); lw = 0; continue; }
      const f = fontOf(st, w.bold, st.italic);
      let ww = tw(w.t, f, size);
      if (lw + ww > width && lines.at(-1).length && w.t.trim()) { lines.push([]); lw = 0; }
      if (!lines.at(-1).length && !w.t.trim()) continue;
      // a word wider than the line is broken
      let t = w.t;
      while (ww > width && t.length > 1) { let k = t.length - 1; while (k > 1 && tw(t.slice(0, k), f, size) > width) k--; lines.at(-1).push({ t: t.slice(0, k), f, ww: tw(t.slice(0, k), f, size) }); lines.push([]); t = t.slice(k); ww = tw(t, f, size); }
      lines.at(-1).push({ t, f, ww }); lw += ww;
    }
    for (const line of lines) {
      while (line.length && !line.at(-1).t.trim()) line.pop();
      ensure(lineH);
      const total = line.reduce((a, w) => a + w.ww, 0);
      let cx = st.align === 'right' ? x + width - total : st.align === 'center' ? x + (width - total) / 2 : x;
      // consecutive words in the same font are one piece of text (copyable, searchable)
      const pieces = [];
      for (const w of line) { const last = pieces.at(-1); if (last && last.f === w.f) { last.t += w.t; last.ww += w.ww; } else pieces.push({ ...w }); }
      for (const w of pieces) { textOp(cx, y + size, w.t, w.f, size, rgb(st.color)); cx += w.ww; }
      y += lineH;
    }
  }

  const AGG = {
    sum: v => v.reduce((a, b) => a + (Number(b) || 0), 0),
    avg: v => (v.length ? v.reduce((a, b) => a + (Number(b) || 0), 0) / v.length : 0),
    count: v => v.length,
    min: v => (v.length ? Math.min(...v.map(Number)) : 0),
    max: v => (v.length ? Math.max(...v.map(Number)) : 0),
  };
  function table(it, ctx, x, width) {
    const st = style(it);
    let rows = lookup(ctx, it.table);
    if (!Array.isArray(rows)) { if (!known(ctx, it.table)) warn(`Unknown table ${it.table}`); rows = []; }
    const cols = (it.columns || []).filter(c => cond(c.if, ctx));
    // calculated columns
    const calcs = cols.filter(c => c.calc);
    if (calcs.length) rows = rows.map((row, k) => {
      const r = { ...row };
      for (const c of calcs) {
        const key = String(c.field || c.title || 'calc').toLowerCase();
        try { r[key] = evaluate(String(c.calc), { ...ctx, ...r, index: k + 1 }); } catch (e) { warn(`Column ${c.title || key}: ${e.message}`); r[key] = ''; }
        if (!c.field) c.field = key;
      }
      return r;
    });
    const size = Number(st.size || 9), lineH = size * 1.25, pad = size * 0.55;
    const totalW = cols.reduce((s, c) => s + Number(c.width || 1), 0);
    const widths = cols.map(c => Number(c.width || 1) / totalW * width);
    const cell = (c, row, k) => {
      const scope = { ...ctx, ...row, index: k + 1 };
      if (c.value !== undefined) return fillT(c.value, scope);
      if (c.field && !c.calc && !known(row, c.field) && !known(ctx, c.field)) warn(`Unknown field ${c.field} in the lines of ${it.table}`);
      const raw = lookup(row, c.field);
      if (!c.format) return format(raw, undefined, loc);
      const [kind, arg] = String(c.format).split(':');
      return format(raw, kind, loc, arg?.startsWith('{') ? lookup(scope, arg.slice(1, -1)) : arg);
    };
    // firstWidth: the first cell spans the empty columns after it (labels of totals)
    const layoutRow = (vals, bold, firstWidth) => cols.map((c, i) => {
      const f = fontOf(st, bold, false), cw = (i === 0 && firstWidth ? firstWidth : widths[i]) - 8, text = String(vals[i] ?? '');
      if (c.wrap === false || st.wrap === false) {
        let t = text;
        if (tw(t, f, size) > cw) { while (t && tw(`${t}…`, f, size) > cw) t = t.slice(0, -1); t += '…'; }
        return { f, lines: [t] };
      }
      return { f, lines: wrap(text, f, size, cw) };
    });
    const heightOf = cells => Math.max(1, ...cells.map(c => c.lines.length)) * lineH + pad * 2;
    const drawRow = (cells, { fill: bg, line = '#e2e8f0' } = {}) => {
      const rowH = heightOf(cells);
      if (bg) ops.push({ op: 'rect', x, y, w: width, h: rowH, fill: rgb(bg) });
      let cx = x;
      cols.forEach((c, i) => {
        const { f, lines } = cells[i], cw = widths[i] - 8, align = c.align || 'left';
        lines.forEach((t, k) => {
          if (!t.trim()) return;
          const px = align === 'right' ? cx + 4 + cw - tw(t, f, size) : align === 'center' ? cx + 4 + (cw - tw(t, f, size)) / 2 : cx + 4;
          textOp(px, y + pad + size * 0.85 + k * lineH, t, f, size, rgb(c.color));
        });
        cx += widths[i];
      });
      if (line) ops.push({ op: 'line', x1: x, y1: y + rowH, x2: x + width, y2: y + rowH, color: rgb(line) });
      y += rowH;
    };
    const headCells = layoutRow(cols.map(c => c.title ?? c.field), true);
    const head = () => { ensure(heightOf(headCells) * 2); drawRow(headCells, { fill: st.headerColor || '#eef2f7', line: '#cbd5e1' }); };
    const totalOf = (list, c) => {
      const kind = it.total?.[c.field] ?? (it.subtotal && typeof it.subtotal === 'object' ? it.subtotal[c.field] : undefined);
      return kind ? AGG[kind]?.(list.map(r => lookup(r, c.field))) ?? (warn(`Unknown total ${kind} (sum, avg, count, min, max)`), '') : null;
    };
    const sumRow = (list, label, spec) => {
      const vals = cols.map((c, i) => {
        const kind = spec?.[c.field];
        if (kind) { const v = AGG[kind]?.(list.map(r => lookup(r, c.field))); if (v === undefined) { warn(`Unknown total ${kind} (sum, avg, count, min, max)`); return ''; } return kind === 'count' ? String(v) : format(v, String(c.format || 'amount').split(':')[0] === 'currency' ? 'amount' : String(c.format || 'amount').split(':')[0], loc); }
        return i === 0 ? label : '';
      });
      const firstValue = cols.findIndex(c => spec?.[c.field]);
      const span = firstValue > 0 ? widths.slice(0, firstValue).reduce((a, b) => a + b, 0) : widths[0];
      const cells = layoutRow(vals, true, span);
      if (!state.noBreak && y + heightOf(cells) > bottom) { newPage(); head(); }
      ops.push({ op: 'line', x1: x, y1: y, x2: x + width, y2: y, color: rgb('#94a3b8') });
      drawRow(cells, { line: null });
    };
    void totalOf;
    head();
    const subSpec = it.subtotal === true ? it.total : it.subtotal;
    let groupKey, groupRows = [], k = 0;
    for (const row of rows) {
      const g = it.groupBy ? String(lookup(row, it.groupBy)) : undefined;
      if (it.groupBy && g !== groupKey) {
        if (groupKey !== undefined && subSpec) sumRow(groupRows, fillT(it.subtotalLabel || 'Subtotal', { ...ctx, ...rows[k - 1] }), subSpec);
        groupKey = g; groupRows = [];
        if (it.groupHeader !== false) {
          // the group header spans the table
          const f = fontOf(st, true, false), lines = wrap(fillT(it.groupHeader || `{${it.groupBy}}`, { ...ctx, ...row }), f, size, width - 8);
          const h = lines.length * lineH + pad * 2;
          if (!state.noBreak && y + h + lineH * 3 > bottom) { newPage(); head(); }
          lines.forEach((t, n) => textOp(x + 4, y + pad + size * 0.85 + n * lineH, t, f, size, rgb('#0a3d7a')));
          y += h;
        }
      }
      const cells = layoutRow(cols.map(c => cell(c, row, k)), false);
      if (!state.noBreak && y + heightOf(cells) > bottom) { newPage(); head(); }
      groupRows.push(row);
      drawRow(cells, { fill: it.stripes && k % 2 ? '#f8fafc' : null });
      k++;
    }
    if (it.groupBy && groupKey !== undefined && subSpec) sumRow(groupRows, fillT(it.subtotalLabel || 'Subtotal', { ...ctx, ...rows.at(-1) }), subSpec);
    if (it.total) sumRow(rows, it.totalLabel || 'Total', it.total);
    y += 6;
  }

  function input(it, ctx, x, width) {
    const type = it.type || 'text';
    const name = fillT(it.input, ctx);
    if (!state.noBreak) { if (names.has(name)) warn(`The input field ${name} exists twice (field names must be unique; use {index} in repeats)`); names.add(name); }
    const label = it.label !== undefined ? fillT(it.label, ctx) : '';
    let value = it.value !== undefined ? fillT(it.value, ctx) : (known(ctx, name) ? format(lookup(ctx, name), undefined, loc) : '');
    // a calculated fillable field: its value from the data and the fields before it; recalculated in the PDF
    let js;
    if (it.calc) {
      try { const v = evaluate(String(it.calc), { ...ctx, ...inputValues }); value = typeof v === 'number' ? String(Math.round(v * 1e6) / 1e6) : String(v ?? ''); } catch (e) { warn(`Calculation of ${name}: ${e.message}`); }
      if (archive) warn(`Field ${name}: PDF/A allows no JavaScript, so its calculation is not recalculated in the PDF`);
      else try { js = toAcrobatJs(it.calc, { fields: new Set(Object.keys(inputValues)), data: { ...ctx, ...inputValues } }); } catch (e) { warn(`Field ${name}: ${e.message}`); }
    }
    if (!state.measuring) inputValues[name] = type === 'checkbox' ? (truthy(value) ? 'X' : '') : value;
    const size = Number(it.size || 9);
    const w = Math.min(width, it.width ? len(it.width) : type === 'checkbox' ? 12 : width);
    const h = it.height ? len(it.height) : type === 'multiline' ? 54 : type === 'signature' ? 48 : type === 'checkbox' ? 12 : 18;
    const sign = signature && type === 'signature' && (!signature.field || signature.field === name);
    if (type === 'checkbox') {
      ensure(h + 6);
      if (interactive || state.noBreak) ops.push({ op: 'field', type, name, x, y, w, h, value: truthy(value) ? 'X' : '', required: it.required, readOnly: it.readOnly, tooltip: it.tooltip || label });
      if (!interactive) { ops.push({ op: 'rect', x, y, w, h, stroke: rgb('#64748b') }); if (truthy(value)) textOp(x + 2, y + h - 2, 'X', 'Helvetica-Bold', h * 0.9); }
      if (label) textOp(x + w + 6, y + h * 0.8, label, fontOf(style(it), false, false), size, null);
      y += h + 6;
      return;
    }
    const labelH = label ? size * 1.4 : 0;
    ensure(labelH + h + 6);
    if (label) textOp(x, y + size, label + (it.required ? ' *' : ''), fontOf(style(it), true, false), size * 0.9, rgb('#475569'));
    y += labelH;
    if (interactive || sign) ops.push({ op: 'field', type, name, x, y, w, h, value, js, options: (Array.isArray(it.options) ? it.options : String(it.options || '').split(',').filter(Boolean)).map(o => fillT(o, ctx)), required: it.required, readOnly: it.readOnly, maxLength: it.maxLength, tooltip: it.tooltip || label, size: it.fontSize });
    else {
      // printed (not fillable): the value in a frame
      ops.push({ op: 'rect', x, y, w, h, stroke: rgb('#94a3b8') });
      const f = fontOf(style(it), false, false);
      wrap(value, f, size, w - 6).slice(0, Math.max(1, Math.floor((h - 4) / (size * 1.2)))).forEach((t, k) => textOp(x + 3, y + 3 + size + k * size * 1.2, t, f, size, null));
    }
    y += h + 6;
  }

  // an item, and in design mode where it landed (flowed items: the full width from the start to the end of it, on
  // every page it covers; positioned boxes: their frame)
  function item(raw, ctx, x, width, at) {
    if (!design || at === undefined || state.measuring) return draw(raw, ctx, x, width, at);
    const p0 = pageNo, y0 = y;
    state.placed = null;
    draw(raw, ctx, x, width, at);
    const kind = Object.keys(raw || {}).find(k => ITEMS.includes(k)) || 'item';
    if (state.placed) { boxes.push({ path: at, kind, page: p0, ...state.placed }); state.placed = null; return; }
    if (pageNo === p0) { if (y > y0 || cond(raw?.if, ctx)) boxes.push({ path: at, kind, page: p0, x, y: y0, w: width, h: y - y0, ...(cond(raw?.if, ctx) ? {} : { hidden: true }) }); return; }
    boxes.push({ path: at, kind, page: p0, x, y: y0, w: width, h: bottom - y0 });
    for (let p = p0 + 1; p < pageNo; p++) boxes.push({ path: at, kind, page: p, x, y: top, w: width, h: bottom - top, cont: true });
    boxes.push({ path: at, kind, page: pageNo, x, y: top, w: width, h: y - top, cont: true });
  }
  function draw(raw, ctx, x, width, at) {
    const sub = (k, j) => (at === undefined ? undefined : `${at}.${k}.${j}`);
    if (!raw || typeof raw !== 'object') { warn(`Not an item: ${JSON.stringify(raw)}`); return; }
    if (!cond(raw.if, ctx)) return;
    const it = style(raw);
    if (it.pageBreakBefore && y > top) newPage();
    if (it.keepTogether && !state.noBreak) { const h = measure({ ...raw, keepTogether: false, pageBreakBefore: false }, ctx, width); if (y + h > bottom && y > top) newPage(); }
    if (it.pagebreak) { if (!state.noBreak) newPage(); return; }
    if (it.space) { y += len(it.space); return; }
    if (it.line) { ensure(8); ops.push({ op: 'line', x1: x, y1: y + 3, x2: x + width, y2: y + 3, color: rgb(it.color || '#b0bac5') }); y += 8; return; }
    if (it.text !== undefined) return textBlock(it.text, ctx, x, width, it);
    if (it.textModule) {
      const t = form.texts?.[it.textModule];
      if (!t) warn(`Unknown text module ${it.textModule}`);
      const s = t ? (typeof t === 'string' ? t : t[lang(loc)] ?? t.en ?? Object.values(t)[0]) : `[text module ${it.textModule}]`;
      return textBlock(s, ctx, x, width, it);
    }
    if (it.fields) {
      const size = Number(it.size || 10), st = style(it);
      const lf = fontOf(st, true, false), vf = fontOf(st, false, false);
      const labelW = Math.min(width / 2, Math.max(...it.fields.map(([l]) => tw(fillT(l, ctx), lf, size))) + 14);
      for (const [label, value, kind] of it.fields) {
        const v = kind ? format(lookup(ctx, String(value).replace(/[{}]/g, '').split(':')[0]), kind, loc) : fillT(value, ctx);
        const lines = wrap(v, vf, size, width - labelW);
        ensure(size * 1.6 * lines.length);
        textOp(x, y + size * 1.15, fillT(label, ctx), lf, size, rgb('#475569'));
        lines.forEach((t, k) => textOp(x + labelW, y + size * 1.15 + k * size * 1.35, t, vf, size, null));
        y += size * 1.6 + (lines.length - 1) * size * 1.35;
      }
      y += 4;
      return;
    }
    if (it.table) return table(it, ctx, x, width);
    if (it.input) return input(it, ctx, x, width);
    if (it.repeat) {
      const rows = lookup(ctx, it.repeat);
      if (!Array.isArray(rows) && !known(ctx, it.repeat)) warn(`Unknown table ${it.repeat}`);
      (Array.isArray(rows) ? rows : []).forEach((row, k) => { (it.items || []).forEach((s, j) => item(s, { ...ctx, ...row, index: k + 1 }, x, width, k === 0 ? sub('items', j) : undefined)); });
      return;
    }
    if (it.image) {
      const img = loadImage(it.image, ctx);
      if (!img) return;
      let w = it.width ? len(it.width) : Math.min(width, img.width), h = it.height ? len(it.height) : w * img.height / img.width;
      if (w > width) { h = h * width / w; w = width; }
      ensure(h + 4);
      const px = it.align === 'right' ? x + width - w : it.align === 'center' ? x + (width - w) / 2 : x;
      ops.push({ op: 'image', img, x: px, y, w, h });
      y += h + 4;
      return;
    }
    if (it.barcode) {
      const value = fillT(it.value ?? '', ctx);
      if (!value) return;
      let bc;
      try { bc = barcode(it.barcode, value, { level: it.level }); } catch (e) { warn(`Barcode: ${e.message}`); return; }
      if (bc.kind === 'matrix' && (bc.rows ?? bc.modules) !== bc.modules) {
        // a rectangular symbol (PDF417): width and height
        const w = Math.min(width, len(it.width || 180)), h = len(it.height || Math.max(20, w * bc.rows / bc.modules * 3));
        ensure(h + 4);
        const px = it.align === 'right' ? x + width - w : it.align === 'center' ? x + (width - w) / 2 : x;
        ops.push({ op: 'matrix', x: px, y, mx: w / bc.modules, my: h / bc.rows, dark: bc.dark });
        y += h + 4;
      } else if (bc.kind === 'matrix') {
        const size = len(it.size || 80), m = size / bc.modules;
        ensure(size + 4);
        const px = it.align === 'right' ? x + width - size : it.align === 'center' ? x + (width - size) / 2 : x;
        ops.push({ op: 'qr', x: px, y, m, dark: bc.dark });
        y += size + 4;
      } else {
        const w = Math.min(width, len(it.width || 180)), h = len(it.height || 40), mod = w / bc.width, th = it.text === false ? 0 : 10;
        ensure(h + th + 4);
        const px = it.align === 'right' ? x + width - w : it.align === 'center' ? x + (width - w) / 2 : x;
        ops.push({ op: 'bars', x: px, y, h, mod, bars: bc.bars });
        if (th) { const t = bc.text || value; textOp(px + (w - tw(t, 'Courier', 8)) / 2, y + h + 8, t, 'Courier', 8, null); }
        y += h + th + 4;
      }
      return;
    }
    if (it.columns) {
      const gap = len(it.gap ?? 12), total = it.columns.reduce((s, c) => s + Number(c.width || 1), 0), avail = width - gap * (it.columns.length - 1);
      const heights = it.columns.map(c => measure({ box: c.items || [], flow: true }, ctx, Number(c.width || 1) / total * avail));
      const maxH = Math.max(0, ...heights);
      if (!state.noBreak && y + maxH > bottom && y > top) newPage();
      const y0 = y;
      let cx = x;
      const saveBreak = state.noBreak; state.noBreak = true;
      it.columns.forEach((c, ci) => {
        const cw = Number(c.width || 1) / total * avail; y = y0;
        if (design && at !== undefined && !state.measuring) boxes.push({ path: `${at}.columns.${ci}`, kind: 'column', page: pageNo, x: cx, y: y0, w: cw, h: maxH });
        (c.items || []).forEach((s, j) => item(s, ctx, cx, cw, at === undefined ? undefined : `${at}.columns.${ci}.items.${j}`));
        cx += cw + gap;
      });
      state.noBreak = saveBreak;
      y = y0 + maxH;
      return;
    }
    if (it.box) {
      if (it.flow) { for (const sub of it.box) item(sub, ctx, x, width); return; }   // (measuring columns)
      // a positioned box (an address window, a stamp): on the current page, its own cursor, no page breaks
      const bx = len(it.x ?? 0), by = len(it.y ?? 0), bw = len(it.width || 200), bh = it.height ? len(it.height) : null, pad = len(it.padding ?? (it.border || it.fill ? 6 : 0));
      const savedY = y, saveBreak = state.noBreak;
      state.noBreak = true;
      const start = ops.length;
      y = by + pad;
      it.box.forEach((s, j) => item(s, ctx, bx + pad, bw - 2 * pad, sub('box', j)));
      const h = bh ?? (y - by + pad);
      state.placed = { x: bx, y: by, w: bw, h: Math.max(h, 8), positioned: true };
      if (it.fill || it.border) ops.splice(start, 0, { op: 'rect', x: bx, y: by, w: bw, h, fill: rgb(it.fill), stroke: rgb(it.border) });
      y = savedY; state.noBreak = saveBreak;
      return;
    }
    warn(`Unknown item ${JSON.stringify(raw).slice(0, 60)} (items: ${ITEMS.join(', ')})`);
  }

  const blocks = list => (list || []).reduce((h, it) => h + measure(it, { ...data, page: 1, pages: 1 }, W - M.left - M.right), 0);
  headerH = Math.max(blocks(form.header), blocks(form.firstHeader)) + (form.header?.length || form.firstHeader?.length ? 10 : 0);
  footerH = blocks(form.footer) + (form.footer?.length ? 6 : 0);
  top = M.top + headerH; bottom = H - M.bottom - footerH;
  if (bottom - top < 60) warn('The header and footer leave almost no room for the content');
  newPage();
  (form.content || []).forEach((it, j) => item(it, data, M.left, W - M.left - M.right, `content.${j}`));
  // master page: header (first page: firstHeader) and footer on every page, page numbers, watermark
  const all = pages.length;
  pages.forEach((p, i) => {
    ops = p; pageNo = i;
    const ctx = { ...data, page: i + 1, pages: all };
    const saveBreak = state.noBreak; state.noBreak = true;
    const head = i === 0 && form.firstHeader ? form.firstHeader : form.header;
    y = M.top; (head || []).forEach((it, j) => item(it, ctx, M.left, W - M.left - M.right, `${head === form.firstHeader && i === 0 && form.firstHeader ? 'firstHeader' : 'header'}.${j}`));
    if (head?.length && form.headerLine !== false) ops.push({ op: 'line', x1: M.left, y1: M.top + headerH - 5, x2: W - M.right, y2: M.top + headerH - 5, color: rgb('#cbd5e1') });
    y = H - M.bottom - footerH + 6; (form.footer || []).forEach((it, j) => item(it, ctx, M.left, W - M.left - M.right, `footer.${j}`));
    state.noBreak = saveBreak;
    const wm = form.watermark;
    if (wm && cond(wm.if, ctx)) {
      const f = fontOf(typeof wm === 'object' ? wm : {}, true, false);
      const t = fillT(typeof wm === 'string' ? wm : wm.text, ctx), size = Number(wm.size || 90);
      const twm = tw(t, f, size), a = Math.atan2(H, W);
      ops.unshift({ op: 'text', x: W / 2 - Math.cos(a) * twm / 2, y: H / 2 + Math.sin(a) * twm / 2 + size * 0.3, text: t, font: f, size, color: rgb(wm.color || '#94a3b8'), angle: a * 180 / Math.PI, opacity: wm.opacity ?? 0.18 });
    }
  });

  pdf.title = fill(form.title || '', data, loc);
  const fields = [];
  for (const p of pages) {
    pdf.addPage(W, H);
    for (const o of p) {
      if (o.op === 'text') pdf.text(o.x, o.y, o.text, { font: o.font, size: o.size, color: o.color, angle: o.angle, opacity: o.opacity });
      else if (o.op === 'line') pdf.line(o.x1, o.y1, o.x2, o.y2, { color: o.color });
      else if (o.op === 'rect') pdf.rect(o.x, o.y, o.w, o.h, { fill: o.fill, stroke: o.stroke });
      else if (o.op === 'image') pdf.image(o.img, o.x, o.y, o.w, o.h);
      else if (o.op === 'bars') for (const b of o.bars) pdf.rect(o.x + b.x * o.mod, o.y, b.w * o.mod, o.h, { fill: [0, 0, 0] });
      else if (o.op === 'qr') for (const [cx, cy] of o.dark) pdf.rect(o.x + cx * o.m, o.y + cy * o.m, o.m + 0.05, o.m + 0.05, { fill: [0, 0, 0] });
      else if (o.op === 'matrix') for (const [cx, cy] of o.dark) pdf.rect(o.x + cx * o.mx, o.y + cy * o.my, o.mx + 0.05, o.my + 0.05, { fill: [0, 0, 0] });
      else if (o.op === 'field') { pdf.field({ ...o }); fields.push({ name: o.name, type: o.type, value: o.value, page: pages.indexOf(p) + 1 }); }
    }
  }
  const sec = archive ? null : security ?? form.security ?? null;
  let out = pdf.render({ ...(signature ? { signature } : {}), ...(archive && pdf.fieldFont ? { pdfa: true } : {}), ...(sec ? { encrypt: sec } : {}) });
  if (signature) out = signPdf(out, signature);
  // the text of every page (for checks and the command line: what a reader sees)
  const text = pages.map(p => p.filter(o => o.op === 'text' && !o.angle).sort((a, b) => a.y - b.y || a.x - b.x)
    .reduce((lines, o) => { const l = lines.at(-1); if (l && Math.abs(l.y - o.y) < 2) l.t += ` ${o.text}`; else lines.push({ y: o.y, t: o.text }); return lines; }, []).map(l => l.t));
  const result = { pdf: out, pages: pages.length, fields, warnings: [...warnings], text };
  if (design) {
    const ser = o => (o.op === 'image' ? { op: 'image', x: o.x, y: o.y, w: o.w, h: o.h, src: o.img.src ? `data:${o.img.filter === 'DCTDecode' ? 'image/jpeg' : 'image/png'};base64,${Buffer.from(o.img.src).toString('base64')}` : '' }
      : o.op === 'text' ? { ...o, family: /^Courier/.test(o.font) ? 'mono' : /^Times/.test(o.font) ? 'serif' : 'sans', bold: /Bold|-bold/i.test(o.font), italic: /Oblique|Italic/i.test(o.font) } : o);
    result.layout = { width: W, height: H, margin: M, top, bottom, headerTop: M.top, footerTop: H - M.bottom - footerH, pages: pages.map(p => p.map(ser)), boxes };
  }
  return result;
}

// forms of an app: src/<name>.form.json (a RAP Studio layout), or an Adobe XDP layout: src/<name>.xdp, with an
// optional src/<name>.form.json { "layout": "<name>.xdp", "dataProvider": "ZFDP_…", "title", "locale" } (the form
// object: its data provider, like a form in ADT); images next to them in src/ (or forms/)
export function formStore(appDir) {
  const base = name => String(name).trim().toLowerCase();
  const file = name => path.join(appDir, 'src', `${base(name)}.form.json`);
  const xdpFile = name => path.join(appDir, 'src', `${base(name)}.xdp`);
  const meta = name => { const f = file(name); return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null; };
  return {
    exists: name => fs.existsSync(file(name)) || fs.existsSync(xdpFile(name)),
    // a form: the layout object, or { xdp: <Buffer>, dataProvider, title, locale } for an XDP layout
    load: name => {
      const m = meta(name);
      const layout = m?.layout ? path.join(appDir, 'src', path.basename(m.layout)) : xdpFile(name);
      if ((m && m.layout) || (!m && fs.existsSync(layout))) {
        if (!fs.existsSync(layout)) return null;
        return { title: m?.title || String(name).toUpperCase(), dataProvider: m?.dataProvider || '', interface: m?.interface || '', sample: m?.sample, locale: m?.locale, xdp: fs.readFileSync(layout), layoutFile: path.basename(layout) };
      }
      return m;
    },
    list: () => { try { return [...new Set(fs.readdirSync(path.join(appDir, 'src')).filter(f => f.endsWith('.form.json') || f.endsWith('.xdp')).map(f => f.replace(/\.form\.json$|\.xdp$/, '').toUpperCase()))].sort(); } catch { return []; } },
    fontDirs: () => [path.join(appDir, 'fonts'), path.join(appDir, 'src')],
    assets: name => {
      for (const dir of ['src', 'forms', '.']) { const p = path.resolve(appDir, dir, name); if (p.startsWith(path.resolve(appDir)) && fs.existsSync(p)) return fs.readFileSync(p); }
      return null;
    },
  };
}
