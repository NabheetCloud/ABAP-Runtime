// Import of Adobe LiveCycle Designer layouts (XDP, the template of SAP Interactive Forms by Adobe) into a RAP Studio
// form layout (.form.json): the master page (page size, content area as margins, its texts and fields as header
// boxes), subforms (flowed top to bottom, positioned ones row by row), tables (a table subform with a header row and
// a repeating row bound to a data table), texts and fields with their data binding ($.FIELD, $record.X, ITEMS.DATA[*]),
// captions, picture clauses (num / date), barcodes, images (embedded ones become files), lines, check boxes,
// signature fields. Scripts (JavaScript and FormCalc, xfascript.js): calculations become calculated values, initialize
// / ready scripts values or conditions, presence scripts ("hidden" / "visible", of the object or of another one)
// conditions ("if"), scripts of interactive events that set fields: calculations of fillable fields.
// Dynamic forms: flowed subforms (tb, lr-tb, rl-tb, row), repeating subforms (occur max -1 / > 1 or a [*] binding),
// optional ones (occur min 0 bound to data: shown when the data exists), page breaks (breakBefore / breakAfter,
// break), keep intact (kept together on a page), the first page's master page (firstHeader), relevant="-print".
import { parseXml } from '../abap/xslt.js';
import { convertScript } from './xfascript.js';

const els = n => (n?.children || []).filter(c => c.type === 'element');
const local = n => String(n.name).replace(/^.*:/, '');
const child = (n, name) => els(n).find(c => local(c) === name);
const kids = (n, name) => els(n).filter(c => local(c) === name);
const attr = (n, a) => n?.attrs?.find(x => x.name === a)?.value;
const text = n => (n ? (n.type === 'text' ? n.value : (n.children || []).map(text).join('')) : '');
// XFA measurements: in (default), mm, cm, pt
const pt = v => { const m = /^\s*(-?[\d.]+)\s*(mm|cm|in|pt|px)?\s*$/.exec(String(v ?? '')); if (!m) return 0; const n = Number(m[1]); return Math.round((m[2] === 'mm' ? n * 72 / 25.4 : m[2] === 'cm' ? n * 72 / 2.54 : m[2] === 'pt' || m[2] === 'px' ? n : n * 72) * 100) / 100; };
// a data binding -> a data path: $.ITEMS.DATA[*] -> items, $record.HEADER.KUNNR -> header.kunnr
const path = ref => String(ref || '').replace(/^\$record\.|^\$data\.|^\$\.|^\$/, '').replace(/\[\*\]|\[\d+\]/g, '').replace(/\.DATA$/i, '').replace(/\.DATA\./gi, '.').toLowerCase();
const bindOf = n => { const b = child(n, 'bind'); const m = attr(b, 'match'); if (m === 'none') return null; if (m === 'dataRef') return attr(b, 'ref'); return attr(n, 'name') ? `$.${attr(n, 'name')}` : null; };

// XFA barcode types (<barcode type="…">) -> layout barcode types
const XFA_BARCODES = [[/^qr/, 'qr'], [/^datamatrix/, 'datamatrix'], [/^pdf417/, 'pdf417'], [/^aztec/, 'aztec'], [/^maxicode/, 'maxicode'],
  [/^code3of9|^code39/, 'code39'], [/^code93/, 'code93'], [/^code128/, 'code128'], [/^ean13/, 'ean13'], [/^ean8/, 'ean8'], [/^upca/, 'upca'], [/^upce/, 'upce'],
  [/^code2of5interleaved|^itf/, 'itf'], [/^codabar/, 'codabar'], [/^ucc128|^ean128|^gs1/, 'gs1-128']];

export function importXdp(xml, { name = 'form' } = {}) {
  const warnings = [], assets = {};
  const warn = m => { if (!warnings.includes(m)) warnings.push(m); };
  const doc = parseXml(String(xml));
  const find = (n, nm) => { for (const c of els(n)) { if (local(c) === nm) return c; const r = find(c, nm); if (r) return r; } return null; };
  const template = find(doc, 'template');
  if (!template) throw new Error('No XFA template in the file (an .xdp from Adobe LiveCycle Designer is expected)');
  const root = child(template, 'subform');
  const form = { title: name.toUpperCase(), page: {}, header: [], content: [], footer: [] };
  // the repeating rows (object path -> data table, field name -> data field), for FormCalc references
  const rowsByPath = [];
  (function scan(n, objPath) {
    for (const c of els(n).filter(c => local(c) === 'subform')) {
      const p = [...objPath, attr(c, 'name') || ''].filter(Boolean);
      const ref = bindOf(c);
      if (ref && (attr(child(c, 'occur'), 'max') === '-1' || /\[\*\]/.test(ref))) {
        const fields = {};
        for (const f of els(c).filter(f => local(f) === 'field')) { const b = bindOf(f); fields[String(attr(f, 'name') || '').toLowerCase()] = b ? path(b) : String(attr(f, 'name') || '').toLowerCase(); }
        rowsByPath.push({ path: p.join('.').toLowerCase(), table: path(ref), fields });
      }
      scan(c, p);
    }
  })(root, []);
  const formcalcRef = ref => {
    const parts = ref.replace(/\[(\*|\d+)\]/g, '').toLowerCase().split('.');
    for (let k = parts.length - 1; k > 0; k--) {
      const obj = parts.slice(0, k).join('.');
      const row = rowsByPath.find(r => r.path === obj || r.path.endsWith(`.${obj}`));
      if (row) return `${row.table}.${parts.slice(k).map(f => row.fields[f] || f).join('.')}`;
    }
    return parts.join('.');
  };
  let imgN = 0;

  const fontOf = n => { const f = child(n, 'font'); const o = {}; if (attr(f, 'size')) o.size = pt(attr(f, 'size')); if (attr(f, 'weight') === 'bold') o.bold = true; if (attr(f, 'posture') === 'italic') o.italic = true; return o; };
  const alignOf = n => { const a = attr(child(n, 'para'), 'hAlign'); return a === 'center' || a === 'right' ? { align: a } : {}; };
  const pictureOf = n => {
    const pic = text(child(child(n, 'format'), 'picture')) || text(child(child(n, 'ui') && child(n, 'format'), 'picture'));
    if (/^date/i.test(pic)) return 'date';
    if (/^time/i.test(pic)) return 'time';
    if (/^num/i.test(pic)) return /\.9|\.z/i.test(pic) ? 'amount' : 'integer';
    return '';
  };
  const valueText = n => {
    const v = child(n, 'value');
    if (!v) return '';
    const ex = child(v, 'exData');
    if (ex) return text(ex).replace(/\s+/g, ' ').trim();   // rich text: its words
    return text(child(v, 'text') || v).trim();
  };
  // scripts: the field names (-> their data paths) for references, then every script converted once
  const boundByName = {};
  (function names(n) { for (const c of els(n)) { if (local(c) === 'field' && attr(c, 'name')) { const b = bindOf(c); boundByName[attr(c, 'name').toLowerCase()] ??= b ? path(b) : attr(c, 'name').toLowerCase(); } names(c); } })(root);
  // calculated fields first: other scripts that read them get their calculation
  const calcByName = {};
  const ref = p => {
    const k = String(p).toLowerCase();
    if (/^[\w$#]+$/.test(p) && calcByName[k]) return `(${calcByName[k]})`;
    return /^[\w$#]+$/.test(p) && boundByName[k] ? boundByName[k] : formcalcRef(p);
  };
  const STATIC = /^(initialize|ready|docReady|layoutReady|prePrint|indexChange)$/i;
  const INTERACTIVE = /^(click|change|exit|enter|mouse\w+|full|preSave|postSave|preSubmit|postSubmit|preOpen|postOpen)$/i;
  const scripts = new Map();   // node -> { value, visible }
  const effects = {};          // object name -> { visible, value, calc }
  const run = (n, sc, what) => {
    const nm = attr(n, 'name') || '';
    const lang = /javascript/i.test(attr(sc, 'contentType') || '') ? 'js' : 'formcalc';
    const src = text(sc).trim();
    if (!src) return null;
    try {
      const r = convertScript(src, { lang, self: nm, ref });
      for (const note of r.notes) warn(`Script of ${nm || 'an object'} (${what}): ${note}`);
      return r;
    } catch (e) { warn(`${lang === 'js' ? 'JavaScript' : 'FormCalc'} ${what} script of ${nm || 'an object'} not converted (${e.message}): write it as an expression`); return null; }
  };
  const andIf = (a, b) => (!a ? b : !b ? a : `(${a}) and (${b})`);
  const OBJECTS = ['field', 'draw', 'subform', 'subformSet', 'exclGroup', 'area'];
  const all = []; (function collect(n) { for (const c of els(n)) { if (OBJECTS.includes(local(c))) all.push(c); collect(c); } })(root);
  all.unshift(root);
  for (const c of all) {
    const calc = child(c, 'calculate'), sc = calc && child(calc, 'script');
    if (!sc) continue;
    const r = run(c, sc, 'calculate');
    if (!r) continue;
    if (r.value) { scripts.set(c, { value: r.value }); if (attr(c, 'name')) calcByName[attr(c, 'name').toLowerCase()] = r.value; warn(`Calculation of ${attr(c, 'name')} converted to {= ${r.value} }: check it`); }
    for (const e of r.effects) { const t = (effects[e.target.toLowerCase()] ||= {}); if (e.visible) t.visible = andIf(t.visible, e.visible); if (e.value) t.value = e.value; }
  }
  for (const c of all) {
    const own = scripts.get(c) || {};
    for (const ev of kids(c, 'event')) {
      const es = child(ev, 'script'), act = attr(ev, 'activity') || '';
      if (!es) continue;
      if (STATIC.test(act)) {
        const r = run(c, es, act);
        if (!r) continue;
        if (r.value) own.value = r.value;
        if (r.visible) { own.visible = andIf(own.visible, r.visible); warn(`Presence script of ${attr(c, 'name')} converted to the condition ${r.visible}: check it`); }
        for (const e of r.effects) {
          const t = (effects[e.target.toLowerCase()] ||= {});
          if (e.visible) { t.visible = andIf(t.visible, e.visible); warn(`Presence of ${e.target} (script of ${attr(c, 'name') || 'the form'}) converted to the condition ${e.visible}: check it`); }
          if (e.value) t.value = e.value;
        }
      } else if (INTERACTIVE.test(act)) {
        // in Adobe Reader when the user acts: what sets other fields becomes their calculation (recalculated in the
        // filled PDF); the rest is reported
        const r = run(c, es, act);
        if (!r) continue;
        let used = false;
        for (const e of r.effects) if (e.value) { (effects[e.target.toLowerCase()] ||= {}).calc = e.value; used = true; }
        if (!used || r.visible || r.effects.some(e => e.visible)) warn(`Script on ${attr(c, 'name') || 'an object'} (event ${act}) runs in Adobe Reader when the user acts: ${used ? 'its field values became calculations; ' : ''}showing / hiding objects is not part of a PDF form here`);
      } else warn(`Script on ${attr(c, 'name') || 'an object'} (event ${act}) not converted`);
    }
    const val = child(c, 'validate'), vs = val && child(val, 'script');
    if (vs) warn(`Validation script of ${attr(c, 'name') || 'an object'} not converted: use "required" or a check in ABAP`);
    if (Object.keys(own).length) scripts.set(c, own);
    for (const v of kids(c, 'variables')) for (const sc of kids(v, 'script')) warn(`Script object ${attr(sc, 'name') || ''} (functions) not converted`);
  }
  const scriptOf = n => scripts.get(n)?.value || effects[String(attr(n, 'name') || '').toLowerCase()]?.value || null;
  const visibleOf = n => andIf(scripts.get(n)?.visible, effects[String(attr(n, 'name') || '').toLowerCase()]?.visible);
  const withIf = (items, cond) => (cond ? items.map(it => ({ ...it, if: andIf(it.if, cond) })) : items);

  // one XFA object -> layout items
  function convert(n, scope) {
    const vis = visibleOf(n);
    if (/-print/.test(attr(n, 'relevant') || '')) return [];   // not printed
    const hidden = ['hidden', 'inactive', 'invisible'].includes(attr(n, 'presence'));
    if (hidden && !vis) return [];
    return withIf(convertObject(n, scope), vis);
  }
  function convertObject(n, scope) {
    const kind = local(n), nm = attr(n, 'name') || '';
    if (kind === 'draw') {
      const ui = child(n, 'ui'), v = child(n, 'value');
      if (v && child(v, 'line')) return [{ line: true }];
      if (v && child(v, 'rectangle')) return [];
      if (v && child(v, 'image')) return image(child(v, 'image'), nm);
      const t = valueText(n);
      void ui;
      return t ? [{ text: t.replace(/\{/g, '(').replace(/\}/g, ')'), ...fontOf(n), ...alignOf(n) }] : [];
    }
    if (kind === 'field') {
      const ui = child(n, 'ui'), uiKind = ui ? local(els(ui)[0] || { name: 'textEdit' }) : 'textEdit';
      const ref = bindOf(n);
      const field = ref ? (scope ? `${scope}.${path(ref)}` : path(ref)) : nm.toLowerCase();
      const caption = text(child(child(n, 'caption'), 'value')).trim();
      const calc = scriptOf(n);
      const fmt = pictureOf(n);
      const value = calc ? `{= ${calc}${fmt ? ` :${fmt}` : ''}}` : `{${field}${fmt ? `:${fmt}` : ''}}`;
      if (uiKind === 'barcode') {
        const t = String(attr(els(ui)[0], 'type') || '').toLowerCase();
        const type = XFA_BARCODES.find(([re]) => re.test(t))?.[1] || 'code128';
        if (!XFA_BARCODES.some(([re]) => re.test(t))) warn(`Barcode type ${t || '(none)'} of ${nm} printed as Code 128`);
        const square = ['qr', 'datamatrix', 'aztec', 'maxicode'].includes(type);
        return [{ barcode: type, value: `{${field}}`, ...(square ? { size: pt(attr(n, 'w') || '30mm') } : { width: pt(attr(n, 'w') || '60mm'), height: pt(attr(n, 'h') || '15mm') }) }];
      }
      if (uiKind === 'imageEdit') return [{ image: `{${field}}`, ...(attr(n, 'w') ? { width: pt(attr(n, 'w')) } : {}) }];
      if (uiKind === 'signature') return [{ input: (nm || 'signature').toLowerCase(), type: 'signature', label: caption || 'Signature', ...(attr(n, 'w') ? { width: pt(attr(n, 'w')) } : {}) }];
      if (uiKind === 'checkButton') return [{ input: field || nm.toLowerCase(), type: 'checkbox', label: caption, ...(ref ? { value: `{${field}}` } : {}) }];
      if (uiKind === 'choiceList') {
        const items = kids(n, 'items')[0];
        return [{ input: field || nm.toLowerCase(), type: 'dropdown', label: caption, ...(ref ? { value: `{${field}}` } : {}), options: items ? els(items).map(text) : [] }];
      }
      const icalc = effects[nm.toLowerCase()]?.calc || (calc && attr(n, 'access') === 'open' ? calc : null);
      if (attr(n, 'access') === 'open' || (attr(n, 'access') === undefined && uiKind === 'textEdit' && !ref) || icalc) {
        const multi = attr(els(ui || {})[0], 'multiLine') === '1';
        return [{ input: field || nm.toLowerCase(), type: multi ? 'multiline' : 'text', label: caption, ...(ref ? { value: `{${field}}` } : {}), ...(icalc ? { calc: icalc } : {}) }];
      }
      return caption ? [{ fields: [[caption, value]], ...fontOf(n) }] : [{ text: value, ...fontOf(n), ...alignOf(n) }];
    }
    if (kind === 'subform' || kind === 'subformSet' || kind === 'area') return subform(n, scope);
    if (kind === 'exclGroup') return els(n).filter(c => local(c) === 'field').flatMap(c => convert(c, scope));
    return [];
  }
  function image(img, nm) {
    const href = attr(img, 'href'), data = text(img).trim();
    if (data) {
      const ext = /png/i.test(attr(img, 'contentType') || '') ? 'png' : 'jpg';
      const file = `${name.toLowerCase()}_${(nm || `image${++imgN}`).toLowerCase()}.${ext}`;
      assets[file] = Buffer.from(data.replace(/\s/g, ''), 'base64');
      return [{ image: file }];
    }
    if (href) { warn(`Image ${href} is linked: copy it into src/ as ${href.split(/[\\/]/).pop()}`); return [{ image: href.split(/[\\/]/).pop() }]; }
    return [];
  }
  // a table subform: header row (draws) + body rows (a repeating row bound to a table)
  function table(n, scope) {
    const rows = kids(n, 'subform');
    const header = rows.find(r => !child(r, 'occur') || attr(child(r, 'occur'), 'max') !== '-1');
    const body = rows.find(r => attr(child(r, 'occur'), 'max') === '-1' || /\[\*\]/.test(bindOf(r) || ''));
    if (!body) return rows.flatMap(r => convert(r, scope));
    const widths = String(attr(n, 'columnWidths') || '').split(/\s+/).filter(Boolean).map(pt);
    const cells = els(body).filter(c => ['field', 'draw'].includes(local(c)));
    const titles = header ? els(header).filter(c => ['field', 'draw'].includes(local(c))).map(c => valueText(c) || text(child(child(c, 'caption'), 'value')).trim()) : [];
    const columns = cells.map((c, i) => {
      const col = { title: titles[i] ?? attr(c, 'name') ?? '' };
      if (widths[i]) col.width = widths[i];
      if (local(c) === 'draw') { col.value = valueText(c); return col; }
      const calc = scriptOf(c);
      const ref = bindOf(c);
      col.field = ref ? path(ref) : String(attr(c, 'name') || '').toLowerCase();
      if (calc) col.calc = calc;
      const fmt = pictureOf(c);
      if (fmt) col.format = fmt;
      if (fmt === 'amount' || fmt === 'integer') col.align = 'right';
      return col;
    });
    const data = path(bindOf(body) || bindOf(n) || attr(body, 'name'));
    return [{ table: scope ? `${scope}.${data}` : data, columns }];
  }
  function subform(n, scope) {
    const layout = attr(n, 'layout') || 'position';
    const occur = child(n, 'occur');
    const ref = bindOf(n);
    const explicit = attr(child(n, 'bind'), 'match') === 'dataRef';
    const max = attr(occur, 'max'), min = attr(occur, 'min');
    const repeats = max === '-1' || Number(max) > 1 || /\[\*\]/.test(ref || '');
    if (layout === 'table') return table(n, scope);
    // a subform bound to a structure: its fields are relative to it; a repeating one: to its lines
    if (repeats && ref) scope = '';
    else if (explicit && ref) scope = scope ? `${scope}.${path(ref)}` : path(ref);
    const objects = els(n).filter(c => ['subform', 'subformSet', 'area', 'field', 'draw', 'exclGroup'].includes(local(c)));
    const W = pt(attr(n, 'w')) || 0;
    let items;
    if (layout === 'position') {
      // positioned objects: row by row (same y: side by side)
      const sorted = objects.map(o => ({ o, x: pt(attr(o, 'x')), y: pt(attr(o, 'y')), w: pt(attr(o, 'w')) })).sort((a, b) => a.y - b.y || a.x - b.x);
      const rows = [];
      for (const s of sorted) { const r = rows.at(-1); if (r && Math.abs(r[0].y - s.y) < 6) r.push(s); else rows.push([s]); }
      items = rows.flatMap(r => {
        if (r.length === 1) return convert(r[0].o, scope);
        return [{ columns: r.map(s => ({ width: s.w || 1, items: convert(s.o, scope) })) }];
      });
    } else if (/^(lr-tb|rl-tb|row)$/.test(layout)) {
      // flowed left to right (right to left), wrapping at the subform's width: rows of columns
      const objs = objects.map(o => ({ o, w: pt(attr(o, 'w')) || pt(attr(o, 'minW')) || 0 }));
      if (layout === 'rl-tb') objs.reverse();
      const rows = [];
      let cur = [], used = 0;
      for (const s of objs) {
        if (layout !== 'row' && cur.length && (!s.w || (W && used + s.w > W + 0.5))) { rows.push(cur); cur = []; used = 0; }
        cur.push(s); used += s.w;
        if (!s.w && layout !== 'row') { rows.push(cur); cur = []; used = 0; }
      }
      if (cur.length) rows.push(cur);
      items = rows.flatMap(r => {
        const conv = r.map(s => ({ width: s.w || 1, items: convert(s.o, scope) })).filter(c => c.items.length);
        if (!conv.length) return [];
        return conv.length === 1 && !(W && r[0].w && r[0].w < W * 0.9) ? conv[0].items : [{ columns: conv, gap: 0 }];
      });
    } else items = objects.flatMap(o => convert(o, scope));
    // page breaks: breakBefore / breakAfter (targetType pageArea or contentArea), the older break element
    const brk = child(n, 'break');
    const before = (child(n, 'breakBefore') && /pageArea|contentArea/.test(attr(child(n, 'breakBefore'), 'targetType') || '')) || /pageArea|contentArea/.test(attr(brk, 'before') || '');
    const after = (child(n, 'breakAfter') && /pageArea|contentArea/.test(attr(child(n, 'breakAfter'), 'targetType') || '')) || /pageArea|contentArea/.test(attr(brk, 'after') || '');
    // keep intact: the subform stays on one page (a one-column group kept together)
    const keep = /contentArea|pageArea/.test(attr(child(n, 'keep'), 'intact') || '') && items.length;
    let out;
    if (repeats && ref) out = [{ repeat: path(ref), items: keep ? [{ columns: [{ width: 1, items }], gap: 0, keepTogether: true }] : items }];
    else if (repeats && !ref && Number(attr(occur, 'initial') || min || 1) > 1) out = Array.from({ length: Number(attr(occur, 'initial') || min) }, () => clone(items)).flat();
    else out = keep && items.length > 1 ? [{ columns: [{ width: 1, items }], gap: 0, keepTogether: true }] : keep ? [{ ...items[0], keepTogether: true }] : items;
    // an optional subform bound to data (occur min 0): shown when its data exists
    if (min === '0' && !repeats && ref && explicit) out = withIf(out, `Exists(${path(ref)})`);
    if (before && out.length) out[0] = { ...out[0], pageBreakBefore: true };
    if (after) out.push({ pagebreak: true });
    return out;
  }
  const clone = v => JSON.parse(JSON.stringify(v));
  // master pages: the first page area (the page format); with several page areas, one for the first page (occur max
  // 1, or the first one) gives firstHeader, the next one header and footer
  const pageSet = child(root, 'pageSet');
  const areas = pageSet ? (function all(n) { return els(n).flatMap(c => (local(c) === 'pageArea' ? [c] : local(c) === 'pageSet' ? all(c) : [])); })(pageSet) : [];
  const area = areas[0];
  if (area) {
    const medium = child(area, 'medium');
    let W = pt(attr(medium, 'short') || '210mm'), H = pt(attr(medium, 'long') || '297mm');
    if (attr(medium, 'orientation') === 'landscape') { [W, H] = [H, W]; form.page.orientation = 'landscape'; }
    form.page.size = [W, H].map(v => Math.round(v * 100) / 100);
    const ca = child(area, 'contentArea');
    if (ca) {
      const x = pt(attr(ca, 'x')), y = pt(attr(ca, 'y')), w = pt(attr(ca, 'w')), h = pt(attr(ca, 'h'));
      form.page.margin = { top: y, left: x, right: Math.max(0, Math.round((W - x - w) * 100) / 100), bottom: Math.max(0, Math.round((H - y - h) * 100) / 100) };
    }
    const boxes = a => {
      const head = [], foot = [];
      for (const o of els(a).filter(c => ['draw', 'field', 'subform'].includes(local(c)))) {
        const conv = convert(o, '');
        if (!conv.length) continue;
        const box = { box: conv, x: pt(attr(o, 'x')), y: pt(attr(o, 'y')), width: pt(attr(o, 'w')) || 200 };
        (box.y > H / 2 ? foot : head).push(box);
      }
      return { head, foot };
    };
    const first = boxes(area);
    if (areas.length > 1) {
      const rest = boxes(areas[1]);
      form.firstHeader = first.head;
      form.header = rest.head;
      form.footer = rest.foot.length ? rest.foot : first.foot;
      if (areas.length > 2) warn(`${areas.length} master pages: the first one is used for page 1, the second one for the following pages`);
    } else { form.header = first.head; form.footer = first.foot; }
  }
  form.content = els(root).filter(c => local(c) !== 'pageSet').flatMap(c => convert(c, ''));
  if (!form.header?.length) delete form.header;
  if (!form.firstHeader?.length) delete form.firstHeader;
  if (!form.footer?.length) delete form.footer;
  form.footer ||= [{ text: 'Page {page} of {pages}', size: 8, align: 'center' }];
  form.headerLine = false;
  return { form, assets, warnings };
}
