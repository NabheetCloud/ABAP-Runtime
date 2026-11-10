// Visual designer of Adobe XDP layouts (src/<form>.xdp), in the manner of Adobe LiveCycle Designer's Design View:
// the page exactly as RAP Studio's XFA renderer prints it (the PDF drawn with pdf.js) with the template's objects
// on top: select, move and resize them, drop objects from the Object Library and fields or tables from the Data
// View (the data provider's schema, bound with $. references), edit their properties, reorder them in the
// Hierarchy. Every change is written back to the XDP (the XML stays the source; the Source view shows it), with
// undo and redo. Positions and sizes are written in millimetres.
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const PDFJS = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs';
const PDFJS_WORKER = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs';
let pdfjs = null;
const loadPdfjs = () => (pdfjs ||= import(PDFJS).then(m => { m.GlobalWorkerOptions.workerSrc = PDFJS_WORKER; return m; }));

// XFA measurements -> points; points -> millimetres as the template writes them
export const toPt = (v, def = 0) => {
  const m = /^\s*(-?[\d.]+)\s*(mm|cm|in|pt|px|mp)?\s*$/.exec(String(v ?? ''));
  if (!m) return def;
  const n = Number(m[1]);
  return m[2] === 'mm' ? n * 72 / 25.4 : m[2] === 'cm' ? n * 72 / 2.54 : m[2] === 'pt' || m[2] === 'px' ? n : m[2] === 'mp' ? n / 1000 : n * 72;
};
export const mm = pt => `${String(Math.round(pt * 25.4 / 72 * 1000) / 1000)}mm`;
const toMm = v => Math.round(toPt(v) * 25.4 / 72 * 100) / 100;
const CONTENT = new Set(['subform', 'field', 'draw', 'exclGroup', 'area', 'subformSet', 'pageSet', 'pageArea', 'contentArea']);
const words = s => String(s).replace(/^_+/, '').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ');

// the object library: what a drop creates (XFA template XML; NAME is replaced by a unique name)
const FONT = '<font typeface="Arial" size="10pt"/>';
const MARGIN = '<margin topInset="0.5mm" bottomInset="0.5mm" leftInset="0.5mm" rightInset="0.5mm"/>';
const fieldXml = (name, ui, caption, extra = '', w = '80mm') => `<field name="${name}" w="${w}" h="9mm"><ui>${ui}</ui>${FONT}<margin topInset="1mm" bottomInset="1mm" leftInset="1mm" rightInset="1mm"/><para vAlign="middle"/>${caption !== null ? `<caption reserve="28mm"><font typeface="Arial" size="10pt"/><para vAlign="middle"/><value><text>${esc(caption)}</text></value></caption>` : ''}${extra}</field>`;
const LIBRARY = [
  ['Standard', [
    ['text', 'Text', 'T', 'Text', () => `<draw name="NAME" w="60mm" minH="6mm"><ui><textEdit/></ui><value><text>Text</text></value>${FONT}${MARGIN}</draw>`],
    ['textField', 'Text Field', '▭', 'TextField', () => fieldXml('NAME', '<textEdit/>', 'Text Field')],
    ['numericField', 'Numeric Field', '#', 'NumericField', () => fieldXml('NAME', '<numericEdit/>', 'Amount', '<format><picture>num{z,zzz,zz9.99}</picture></format><para hAlign="right" vAlign="middle"/>')],
    ['dateField', 'Date Field', '📅', 'DateField', () => fieldXml('NAME', '<dateTimeEdit/>', 'Date', '<format><picture>date{DD.MM.YYYY}</picture></format>')],
    ['checkBox', 'Check Box', '☑', 'CheckBox', () => `<field name="NAME" w="50mm" h="7mm"><ui><checkButton size="3.5mm"/></ui>${FONT}<caption placement="right" reserve="40mm"><font typeface="Arial" size="10pt"/><para vAlign="middle"/><value><text>Check Box</text></value></caption><items><integer>1</integer><integer>0</integer></items></field>`],
    ['dropDown', 'Drop-down List', '▾', 'DropDownList', () => fieldXml('NAME', '<choiceList open="onEntry"/>', 'Choice', '<items><text>Option 1</text><text>Option 2</text></items>')],
    ['image', 'Image', '🖼', 'Image', () => '<draw name="NAME" w="40mm" h="20mm"><value><image aspect="fit" href="logo.png"/></value></draw>'],
    ['imageField', 'Image Field', '▣', 'ImageField', () => '<field name="NAME" w="40mm" h="30mm"><ui><imageEdit/></ui></field>'],
    ['line', 'Line', '—', 'Line', () => '<draw name="NAME" w="80mm" h="0mm"><value><line><edge thickness="0.5pt"/></line></value></draw>'],
    ['rectangle', 'Rectangle', '▢', 'Rectangle', () => '<draw name="NAME" w="50mm" h="25mm"><value><rectangle><edge thickness="0.5pt"/></rectangle></value></draw>'],
    ['signature', 'Signature Field', '✍', 'Signature', () => fieldXml('NAME', '<signature/>', 'Signature', '', '90mm').replace('h="9mm"', 'h="15mm"')],
  ]],
  ['Containers', [
    ['subform', 'Subform', '▤', 'Subform', () => '<subform name="NAME" w="80mm" h="40mm"></subform>'],
    ['flowed', 'Flowed Subform', '⇣', 'Subform', () => '<subform name="NAME" layout="tb" w="170mm"></subform>'],
    ['table', 'Table', '▦', 'Table', () => tableXml('NAME', [['Column 1', 'Column1', 'text'], ['Column 2', 'Column2', 'text'], ['Column 3', 'Column3', 'decimal']], null)],
  ]],
  ['Barcodes', [
    ['qr', 'QR Code', '▩', 'QRCode', () => '<field name="NAME" w="25mm" h="25mm"><ui><barcode type="QRCode" moduleWidth="0.6mm" errorCorrectionLevel="1"/></ui><value><text>RAP Studio</text></value></field>'],
    ['code128', 'Code 128', '║', 'Code128', () => '<field name="NAME" w="60mm" h="15mm"><ui><barcode type="code128B" textLocation="below"/></ui><value><text>123456789</text></value></field>'],
    ['datamatrix', 'Data Matrix', '▩', 'DataMatrix', () => '<field name="NAME" w="20mm" h="20mm"><ui><barcode type="dataMatrix"/></ui><value><text>RAP Studio</text></value></field>'],
    ['pdf417', 'PDF417', '▤', 'PDF417', () => '<field name="NAME" w="60mm" h="20mm"><ui><barcode type="pdf417"/></ui><value><text>RAP Studio</text></value></field>'],
  ]],
  ['Custom', [
    ['pageNo', 'Page n of m', 'ⁿ', 'PageNumber', () => `<field name="NAME" w="40mm" h="6mm"><ui><textEdit/></ui><bind match="none"/>${FONT}<para hAlign="right"/><calculate><script contentType="application/x-javascript">"Page " + xfa.layout.page(this) + " of " + xfa.layout.pageCount();</script></calculate></field>`],
    ['today', 'Current Date', '⏲', 'CurrentDate', () => `<field name="NAME" w="40mm" h="6mm"><ui><dateTimeEdit/></ui><bind match="none"/>${FONT}<format><picture>date{DD.MM.YYYY}</picture></format><calculate><script>Num2Date(Date(), "YYYY-MM-DD")</script></calculate></field>`],
    ['total', 'Sum of a Column', 'Σ', 'Total', () => fieldXml('NAME', '<numericEdit/>', 'Total', '<bind match="none"/><format><picture>num{z,zzz,zz9.99}</picture></format><para hAlign="right" vAlign="middle"/><calculate><script>Sum(Table1.Row1[*].Column3)</script></calculate>')],
  ]],
];
export function tableXml(name, cols, rowRef) {
  const w = Math.round(170 / cols.length * 100) / 100;
  const cell = (c, head) => head
    ? `<draw name="${c[1]}Head" w="${w}mm" h="7mm"><ui><textEdit/></ui><value><text>${esc(c[0])}</text></value><font typeface="Arial" size="9pt" weight="bold"/><margin topInset="0.5mm" bottomInset="0.5mm" leftInset="1mm" rightInset="1mm"/><para vAlign="middle"${c[2] === 'decimal' ? ' hAlign="right"' : ''}/><border><edge presence="hidden"/><edge presence="hidden"/><edge thickness="0.5pt"/><edge presence="hidden"/></border></draw>`
    : `<field name="${c[1]}" w="${w}mm" minH="6mm"><ui>${c[2] === 'decimal' ? '<numericEdit/>' : c[2] === 'date' ? '<dateTimeEdit/>' : '<textEdit/>'}</ui><font typeface="Arial" size="9pt"/><margin topInset="0.5mm" bottomInset="0.5mm" leftInset="1mm" rightInset="1mm"/><para vAlign="middle"${c[2] === 'decimal' ? ' hAlign="right"' : ''}/>${c[2] === 'decimal' ? '<format><picture>num{z,zzz,zz9.99}</picture></format>' : c[2] === 'date' ? '<format><picture>date{DD.MM.YYYY}</picture></format>' : ''}${rowRef ? `<bind match="dataRef" ref="$.${c[3] || c[1]}"/>` : ''}</field>`;
  return `<subform name="${name}" layout="table" columnWidths="${cols.map(() => `${w}mm`).join(' ')}" w="170mm"><bind match="none"/>
  <subform name="HeaderRow" layout="row"><assist role="TH"/>${cols.map(c => cell(c, true)).join('')}</subform>
  <subform name="Row1" layout="row"><assist role="TR"/><occur max="-1"/>${rowRef ? `<bind match="dataRef" ref="${rowRef}"/>` : '<bind match="none"/>'}${cols.map(c => cell(c, false)).join('')}</subform>
</subform>`;
}

export function mountXdpDesigner(host, { getText, setText, app, name, api, toast, openFile }) {
  const X = { doc: null, tpl: null, sel: null, layout: null, undo: [], redo: [], zoom: 0, pdf: null, data: null, fdp: null, keys: null, error: null, lastText: null, editKey: '', lastEdit: 0, outlines: true, multi: new Set(), scriptEv: null };
  host.innerHTML = `<div class="fd xd">
    <div class="fd-left"><section class="fd-sec fd-grow"><h4>Hierarchy</h4><div class="fd-tree" tabindex="0"></div></section>
      <section class="fd-sec fd-grow"><h4>Data View <small class="xd-fdp"></small></h4><div class="fd-data"></div></section></div>
    <div class="fd-mid"><div class="fd-tools">
        <button class="btn sm" data-a="undo" title="Undo (Ctrl+Z)">↶</button><button class="btn sm" data-a="redo" title="Redo (Ctrl+Shift+Z)">↷</button>
        <span class="fd-sep"></span><button class="btn sm" data-a="up" title="Move up in the hierarchy (Alt+↑)">↑</button><button class="btn sm" data-a="down" title="Move down in the hierarchy (Alt+↓)">↓</button>
        <button class="btn sm" data-a="dup" title="Duplicate (Ctrl+D)">⧉</button><button class="btn sm" data-a="del" title="Delete (Del)">🗑</button>
        <span class="fd-sep"></span><span class="xd-align" title="Shift / Cmd + click or drag a frame on the page to select several objects"><button class="btn sm" data-a="al" title="Align left edges">⇤</button><button class="btn sm" data-a="ach" title="Align horizontal centres">↔</button><button class="btn sm" data-a="ar" title="Align right edges">⇥</button><button class="btn sm" data-a="at" title="Align top edges">⤒</button><button class="btn sm" data-a="acv" title="Align vertical centres">↕</button><button class="btn sm" data-a="ab" title="Align bottom edges">⤓</button><button class="btn sm" data-a="dh" title="Distribute horizontally">⋯</button><button class="btn sm" data-a="dv" title="Distribute vertically">⋮</button><button class="btn sm" data-a="sw" title="Same width as the last selected">W</button><button class="btn sm" data-a="sh" title="Same height as the last selected">H</button></span>
        <span class="fd-sep"></span><button class="btn sm" data-a="zout" title="Zoom out">−</button><span class="fd-zoom"></span><button class="btn sm" data-a="zin" title="Zoom in">+</button><button class="btn sm" data-a="fit" title="Fit the page width">Fit</button>
        <span class="fd-sep"></span><label class="xd-chk" title="Show the outlines of all objects"><input type="checkbox" class="xd-outl" checked> Outlines</label>
        <span class="fd-sep"></span><button class="btn sm" data-a="xdp" title="Download the layout (.xdp) for Adobe LiveCycle Designer / SAP Forms Service by Adobe">⬇ XDP</button><button class="btn sm" data-a="xsd" title="Download the data provider's XML schema (.xsd): the data connection in LiveCycle Designer">⬇ XSD</button>
        <span class="spacer"></span><select class="fd-rec" title="Data shown on the page"><option value="">First record</option></select><span class="fd-info"></span></div>
      <div class="fd-warn" hidden></div><div class="fd-canvas" tabindex="0"></div></div>
    <div class="fd-right"><section class="fd-sec"><h4>Object Library</h4><div class="fd-lib"></div></section>
      <section class="fd-sec fd-grow"><h4 class="fd-ptitle">Object</h4><div class="fd-props"></div></section></div>
  </div>`;
  const $ = s => host.querySelector(s);
  const canvas = $('.fd-canvas');

  // ---------------------------------------------------------------- model: the XDP as an XML document
  // the text before the root element (XML declaration, <?xfa …?>, comments) is kept as written
  const prolog = t => { const m = /^(?:\s*(?:<\?[^>]*\?>|<!--[\s\S]*?-->))*\s*/.exec(t); return m ? m[0] : ''; };
  function parse() {
    const t = getText();
    const doc = new DOMParser().parseFromString(t, 'application/xml');
    const err = doc.querySelector('parsererror');
    if (err) { X.error = err.textContent.split('\n')[0]; return; }
    const tpl = doc.getElementsByTagNameNS('*', 'template')[0];
    if (!tpl) { X.error = 'No <template> in the XDP'; return; }
    X.error = null; X.doc = doc; X.tpl = tpl;
  }
  const serialize = () => { const t = X.lastText ?? getText(); const tail = /\s*$/.exec(t)[0]; return prolog(t) + new XMLSerializer().serializeToString(X.doc.documentElement) + tail; };
  const nodeAt = p => { if (p === null || p === undefined) return null; let n = X.tpl; if (p === '') return n; for (const i of String(p).split('/')) { n = n?.children[Number(i)]; if (!n) return null; } return n; };
  const pathOf = el => { const s = []; for (let n = el; n && n !== X.tpl; n = n.parentElement) s.unshift([...n.parentElement.children].indexOf(n)); return s.join('/'); };
  const tag = el => el?.localName;
  const kids = (el, t) => [...(el?.children || [])].filter(k => !t || tag(k) === t);
  const kid = (el, t) => kids(el, t)[0] || null;
  // a property element (creating the path: e.g. ensure(el, 'caption', 'value', 'text'))
  function ensure(el, ...tags) {
    let n = el;
    for (const t of tags) { let k = kid(n, t); if (!k) { k = X.doc.createElementNS(X.tpl.namespaceURI, t); n.appendChild(k); } n = k; }
    return n;
  }
  const textOf = el => (el ? el.textContent : '');
  const setTextOf = (el, v) => { el.textContent = v; };
  // new elements from template XML (in the template's namespace)
  const fromXml = xml => { const d = new DOMParser().parseFromString(`<x xmlns="${X.tpl.namespaceURI}">${xml}</x>`, 'application/xml'); return X.doc.importNode(d.documentElement.firstElementChild, true); };
  // insert with the indentation of its siblings
  function place(parent, el, before) {
    const ref = before || null;
    const sib = before || [...parent.childNodes].reverse().find(n => n.nodeType === 1);
    const ws = sib?.previousSibling?.nodeType === 3 && /^\s*$/.test(sib.previousSibling.data) ? sib.previousSibling.data : '\n';
    if (ref) { parent.insertBefore(el, ref); parent.insertBefore(X.doc.createTextNode(ws), ref); }
    else { const last = parent.lastChild; if (last?.nodeType === 3 && /^\s*$/.test(last.data)) { parent.insertBefore(X.doc.createTextNode(ws), last); parent.insertBefore(el, last); } else { parent.appendChild(X.doc.createTextNode(ws)); parent.appendChild(el); } }
    return el;
  }
  function remove(el) { const p = el.previousSibling; if (p?.nodeType === 3 && /^\s*$/.test(p.data)) p.remove(); el.remove(); }
  function uniqueName(base) {
    const names = new Set([...X.tpl.getElementsByTagNameNS('*', '*')].map(e => e.getAttribute('name')).filter(Boolean));
    let i = 1; while (names.has(`${base}${i}`)) i++;
    return `${base}${i}`;
  }
  // where the content of a container is laid out: positioned (x / y) or flowed
  const positioned = el => tag(el) === 'pageArea' || tag(el) === 'area' || ((tag(el) === 'subform' || tag(el) === 'exclGroup') && (el.getAttribute('layout') || 'position') === 'position');
  const containerOf = el => { for (let p = el?.parentElement; p; p = p.parentElement) if (['subform', 'pageArea', 'area', 'exclGroup'].includes(tag(p))) return p; return null; };

  function commit(mutate, key) {
    if (!X.doc) return;
    const before = getText();
    if (mutate() === false) return;
    const text = serialize();
    if (text === before) return;
    if (!(key && key === X.editKey && Date.now() - X.lastEdit < 1500)) { X.undo.push(before); if (X.undo.length > 200) X.undo.shift(); }
    X.editKey = key || ''; X.lastEdit = Date.now();
    X.redo = [];
    X.lastText = text;
    setText(text);
    drawTree(); if (!key) drawProps(); relayout();
  }
  function undoRedo(from, to) {
    if (!from.length) return;
    to.push(getText());
    const t = from.pop();
    X.lastText = t; setText(t); X.editKey = ''; parse();
    if (X.sel && !nodeAt(X.sel)) X.sel = null;
    X.multi = new Set(X.sel ? [X.sel] : []);
    drawTree(); drawProps(); relayout(true);
  }

  // ---------------------------------------------------------------- server: render, layout boxes, data provider
  let seq = 0, timer = null, firstLoad = true;
  function relayout(now) {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      if (X.error) { showWarn([`The XDP is not valid XML: ${X.error} (fix it in the Source view)`], true); return; }
      const my = ++seq;
      const r = await api('POST', `/a/${app}/api/forms/xdp-design`, { name, text: getText(), keys: X.keys || undefined, schema: firstLoad }).catch(e => ({ error: { message: e.message } }));
      if (my !== seq) return;
      if (r.error) { showWarn([r.error.message || String(r.error)], true); return; }
      if (firstLoad) { firstLoad = false; X.fdp = r.dataProvider; X.itf = r.interface || null; X.signature = r.signature || ''; X.data = r.xsd ? xsdTree(r.xsd) : null; drawData(); }
      X.layout = r.layout;
      $('.fd-info').textContent = `${r.pages} page${r.pages === 1 ? '' : 's'}`;
      showWarn((r.warnings || []).filter(w => !/^Script (console|message)/.test(w)));
      const bytes = Uint8Array.from(atob(r.pdf), c => c.charCodeAt(0));
      try { const lib = await loadPdfjs(); X.pdf = await lib.getDocument({ data: bytes }).promise; } catch (e) { X.pdf = null; showWarn([`The page preview could not be drawn (${e.message}); the objects are shown as outlines`], false); }
      if (my === seq) drawPages();
    }, now ? 0 : 300);
  }
  function showWarn(list, bad) { const w = $('.fd-warn'); w.hidden = !list.length; w.classList.toggle('bad', !!bad); w.textContent = list.length ? `${bad ? '' : `${list.length} warning${list.length > 1 ? 's' : ''}: `}${list.slice(0, 4).join(' · ')}` : ''; }

  // ---------------------------------------------------------------- pages: the PDF and the objects on top
  const zoom = () => X.zoom || Math.max(0.5, Math.min(3, (canvas.clientWidth - 48) / (X.layout?.pages[0]?.w || 595)));
  const depth = p => (p === '' ? 0 : String(p).split('/').length);
  let renderTasks = [];
  async function drawPages() {
    const L = X.layout;
    if (!L) return;
    const z = zoom();
    $('.fd-zoom').textContent = `${Math.round(z * 100)}%`;
    const scroll = canvas.scrollTop;
    renderTasks.forEach(t => t.cancel?.()); renderTasks = [];
    canvas.innerHTML = L.pages.map((pg, pi) => `<div class="fd-page" data-page="${pi}" style="width:${pg.w * z}px;height:${pg.h * z}px">
      <canvas class="xd-pdf"></canvas>
      <div class="fd-ov${X.outlines ? ' xd-outl' : ''}" style="transform:scale(${z});width:${pg.w}px;height:${pg.h}px;--hs:${10 / z}px;--bw:${1 / z}px">
        <div class="fd-zone body" style="left:${pg.contentArea.x}px;top:${pg.contentArea.y}px;width:${pg.contentArea.w}px;height:${pg.contentArea.h}px"><span>Content area · page ${pi + 1}</span></div>
        ${ghosts(pi).map(b => `<div class="fd-box xd-ghost" data-path="${b.path}" title="${esc(`${b.name} (${b.presence})`)}" style="left:${b.x}px;top:${b.y}px;width:${Math.max(b.w, 3)}px;height:${Math.max(b.h, 3)}px"><span>${esc(b.presence)}</span></div>`).join('')}
        ${L.boxes.filter(b => b.page === pi).sort((a, b) => depth(a.path) - depth(b.path)).map(b => `<div class="fd-box xd-${b.tag}${X.multi.has(b.path) ? ' sel' : ''}" data-path="${b.path}" title="${esc(`${b.name || b.tag} (${b.tag})`)}" style="left:${b.x}px;top:${b.y}px;width:${Math.max(b.w, 3)}px;height:${Math.max(b.h, 3)}px"></div>`).join('')}
      </div></div>`).join('');
    canvas.scrollTop = scroll;
    markSel();
    if (!X.pdf) return;
    const dpr = window.devicePixelRatio || 1;
    for (const [pi] of L.pages.entries()) {
      if (pi >= X.pdf.numPages) break;
      const page = await X.pdf.getPage(pi + 1);
      const vp = page.getViewport({ scale: z * dpr });
      const cv = canvas.querySelector(`.fd-page[data-page="${pi}"] canvas`);
      if (!cv) return;
      cv.width = vp.width; cv.height = vp.height;
      const task = page.render({ canvasContext: cv.getContext('2d'), viewport: vp });
      renderTasks.push(task);
      await task.promise.catch(() => {});
    }
  }
  // hidden / invisible objects of positioned containers: a ghost outline where the template puts them (they are not
  // painted, so the renderer has no box for them)
  function ghosts(pi) {
    if (!X.tpl || !X.layout) return [];
    const out = [], L = X.layout, pg = L.pages[pi];
    for (const el of X.tpl.getElementsByTagNameNS('*', '*')) {
      if (!['field', 'draw', 'subform', 'exclGroup'].includes(tag(el))) continue;
      const pr = el.getAttribute('presence');
      if (pr !== 'hidden' && pr !== 'invisible') continue;
      const c = containerOf(el);
      if (!c || !positioned(c)) continue;
      const origins = tag(c) === 'pageArea' ? (pg.pageArea === pathOf(c) ? [[0, 0]] : [])
        : c === bodyRoot() ? (pi === 0 ? [[pg.contentArea.x, pg.contentArea.y]] : [])
        : L.boxes.filter(b => b.page === pi && b.path === pathOf(c)).map(b => [b.x, b.y]);
      const w = toPt(el.getAttribute('w') || el.getAttribute('minW'), 85), h = toPt(el.getAttribute('h') || el.getAttribute('minH'), 17);
      for (const [ox, oy] of origins) out.push({ path: pathOf(el), name: el.getAttribute('name') || label(el), presence: pr, x: ox + toPt(el.getAttribute('x')), y: oy + toPt(el.getAttribute('y')), w, h });
    }
    return out;
  }
  function markSel() {
    canvas.querySelectorAll('.fd-box').forEach(b => { b.classList.toggle('sel', X.multi.has(b.dataset.path)); b.querySelectorAll('.fd-h').forEach(h => h.remove()); });
    host.querySelectorAll('.xd-align button').forEach(b => { b.disabled = X.multi.size < (/^d/.test(b.dataset.a) ? 3 : 2); });
    const el = nodeAt(X.sel);
    if (X.multi.size > 1 || !el || !['field', 'draw', 'subform', 'exclGroup'].includes(tag(el))) return;
    const first = canvas.querySelector(`.fd-box[data-path="${X.sel}"]`);
    if (first) first.insertAdjacentHTML('beforeend', '<span class="fd-h se" data-h="se"></span><span class="fd-h e" data-h="e"></span><span class="fd-h s" data-h="s"></span>');
  }
  // select an object; add: Shift / Cmd + click toggles it in a multiple selection
  function select(p, scrollTree, add) {
    if (p !== X.sel) X.scriptEv = null;
    if (add && p !== null && p !== undefined) {
      if (X.multi.has(p) && X.multi.size > 1) { X.multi.delete(p); X.sel = [...X.multi].pop(); }
      else { X.multi.add(p); X.sel = p; }
    } else { X.sel = p; X.multi = new Set(p === null || p === undefined ? [] : [p]); }
    drawTree(scrollTree !== false); drawProps(); markSel();
    const b = canvas.querySelector(`.fd-box[data-path="${p}"]`);
    if (b && scrollTree === false) b.scrollIntoView({ block: 'nearest' });
  }

  // ---------------------------------------------------------------- hierarchy
  const ICON = { subform: '▤', field: '▭', draw: 'T', exclGroup: '◉', area: '▢', subformSet: '⋯', pageSet: '📑', pageArea: '📄', contentArea: '▭' };
  function label(el) {
    const t = tag(el);
    if (t === 'field') { const ui = kid(kid(el, 'ui'), null)?.localName || 'textEdit'; return { textEdit: 'Text Field', numericEdit: 'Numeric Field', dateTimeEdit: 'Date Field', checkButton: 'Check Box', choiceList: 'Drop-down List', imageEdit: 'Image Field', barcode: 'Barcode', signature: 'Signature', button: 'Button', passwordEdit: 'Password' }[ui] || 'Field'; }
    if (t === 'draw') { const v = kid(kid(el, 'value'), null)?.localName; return { line: 'Line', rectangle: 'Rectangle', arc: 'Circle', image: 'Image' }[v] || 'Text'; }
    if (t === 'subform') { const l = el.getAttribute('layout'); return l === 'table' ? 'Table' : l === 'row' ? 'Row' : kid(el, 'occur')?.getAttribute('max') === '-1' ? 'Repeating Subform' : 'Subform'; }
    return { pageSet: 'Master Pages', pageArea: 'Master Page', contentArea: 'Content Area', exclGroup: 'Radio Button Group', area: 'Area' }[t] || t;
  }
  function drawTree(scroll) {
    if (!X.tpl) { $('.fd-tree').innerHTML = ''; return; }
    const rows = [];
    const walk = (el, lvl) => {
      for (const k of kids(el)) {
        if (!CONTENT.has(tag(k))) continue;
        const p = pathOf(k);
        const bind = kid(k, 'bind');
        const ref = bind?.getAttribute('match') === 'dataRef' ? bind.getAttribute('ref') : '';
        const pr = k.getAttribute('presence');
        rows.push(`<div class="fd-row${X.multi.has(p) ? ' sel' : ''}" data-path="${p}" style="padding-left:${8 + lvl * 13}px" title="${esc(ref ? `bound to ${ref}` : '')}"><span class="ic">${ICON[tag(k)] || '·'}</span><b>${esc(k.getAttribute('name') || `(${label(k)})`)}</b><span class="sm">${esc(label(k))}${ref ? ` · ${esc(ref)}` : ''}</span>${pr === 'hidden' || pr === 'invisible' ? `<span class="tag">${esc(pr)}</span>` : ''}</div>`);
        if (tag(k) !== 'field' && tag(k) !== 'draw') walk(k, lvl + 1);
      }
    };
    walk(X.tpl, 0);
    $('.fd-tree').innerHTML = rows.join('');
    const sel = $('.fd-tree .fd-row.sel');
    if (sel && scroll) sel.scrollIntoView({ block: 'nearest' });
  }
  $('.fd-tree').addEventListener('click', e => { const r = e.target.closest('.fd-row'); if (r) select(r.dataset.path, false, e.shiftKey || e.metaKey || e.ctrlKey); });

  // ---------------------------------------------------------------- data view: the data provider's schema
  function xsdTree(xsd) {
    const d = new DOMParser().parseFromString(xsd, 'application/xml');
    const S = d.documentElement;
    const types = new Map(kids(S, 'complexType').map(t => [t.getAttribute('name'), t]));
    const typeOf = el => (el.getAttribute('type') || kid(kid(el, 'simpleType'), 'restriction')?.getAttribute('base') || 'string').replace(/^.*:/, '');
    const build = (el, p) => {
      const nm = el.getAttribute('name');
      const ct = types.get(el.getAttribute('type')) || kid(el, 'complexType');
      const node = { name: nm, path: p, many: el.getAttribute('maxOccurs') === 'unbounded', type: ct ? null : typeOf(el), kids: [] };
      if (ct) for (const c of kid(ct, 'sequence')?.children || []) if (tag(c) === 'element') node.kids.push(build(c, p ? `${p}.${c.getAttribute('name')}` : c.getAttribute('name')));
      return node;
    };
    const top = kid(S, 'element');
    if (!top) return null;
    const root = build(top, '');
    root.name = top.getAttribute('name');
    return root;
  }
  // a to-many wrapper (FDP: <_Items><Items/>…</_Items>): the table node (path of the rows)
  const rowsOf = n => (n.kids.length === 1 && n.kids[0].many ? n.kids[0] : n.many ? n : null);
  function drawData() {
    $('.xd-fdp').textContent = X.fdp ? `(${String(X.fdp).toUpperCase()})` : X.itf ? `(interface ${String(X.itf).toUpperCase()})` : '';
    if (!X.data) { $('.fd-data').innerHTML = `<p class="fd-note">${X.fdp ? 'The data provider has no schema.' : 'No data: give the form a form interface ("interface" in its .form.json, New → Form interface) or a data provider ("dataProvider": a service definition).'}</p>`; return; }
    const out = [];
    const walk = (n, lvl) => {
      for (const k of n.kids) {
        const rows = rowsOf(k);
        if (rows && rows.kids.length) { out.push(`<div class="fd-d tbl" data-d="${esc(rows.path)}" data-t="table" style="padding-left:${6 + lvl * 12}px" title="Drag onto the page: a table with a row per record"><span class="ic">▦</span>${esc(k.name)} <small>table</small></div>`); walk(rows, lvl + 1); continue; }
        if (k.kids.length) { out.push(`<div class="fd-d grp" style="padding-left:${6 + lvl * 12}px"><span class="ic">{}</span>${esc(k.name)}</div>`); walk(k, lvl + 1); continue; }
        out.push(`<div class="fd-d" data-d="${esc(k.path)}" data-t="field" data-type="${esc(k.type)}" style="padding-left:${6 + lvl * 12}px" title="Drag onto the page: a field bound to $.${esc(k.path)}"><span class="ic">•</span>${esc(k.name)}<small>${esc(k.type)}</small></div>`);
      }
    };
    walk(X.data, 0);
    // a classic form: the preview shows sample data (the .form.json "sample", else made up); the driver program
    // calls the generated function module with the interface's parameters
    if (X.itf) out.push(`<p class="fd-note">The preview shows sample data (put your own under "sample" in the form object).</p>${X.signature ? `<details class="fd-sig"><summary>Driver program</summary><pre>${esc(X.signature)}</pre></details>` : ''}`);
    $('.fd-data').innerHTML = out.join('');
  }
  const dataNode = p => { let n = X.data; for (const s of String(p).split('.')) { n = n?.kids.find(k => k.name === s); if (!n) return null; } return n; };
  // the data path a container's content is bound relative to (its subforms' dataRef bindings)
  function contextPath(el) {
    const chain = [];
    for (let p = el; p && p !== X.tpl; p = p.parentElement) if (tag(p) === 'subform') chain.unshift(p);
    let ctx = '';
    for (const s of chain) {
      const b = kid(s, 'bind');
      if (b?.getAttribute('match') !== 'dataRef') continue;
      const ref = (b.getAttribute('ref') || '').replace(/\[[^\]]*\]/g, '');
      if (/^\$record\.|^\$data\.|^!/.test(ref)) ctx = ref.replace(/^\$record\.|^\$data\.|^!/, '');
      else if (/^\$\./.test(ref)) ctx = ctx ? `${ctx}.${ref.slice(2)}` : ref.slice(2);
    }
    return ctx;
  }
  const refFor = (container, p) => { const ctx = contextPath(container); return ctx && p.startsWith(`${ctx}.`) ? `$.${p.slice(ctx.length + 1)}` : ctx ? `$record.${p}` : `$.${p}`; };
  function dataXml(d, container) {
    if (d.type === 'table') {
      const rows = dataNode(d.path);
      const cols = (rows?.kids || []).filter(k => !k.kids.length && !/uuid/i.test(k.name)).slice(0, 6);
      const kind = t => (/decimal|int|float|double/.test(t) ? 'decimal' : /date/.test(t) ? 'date' : 'text');
      const base = rows?.path.split('.').pop() || 'Row';
      return tableXml(uniqueName(`${base}Table`), cols.map(c => [words(c.name), c.name, kind(c.type), c.name]), `${refFor(container, d.path)}[*]`);
    }
    const n = dataNode(d.path), t = n?.type || 'string', fld = d.path.split('.').pop();
    const ui = /date/.test(t) ? '<dateTimeEdit/>' : /decimal|int|float|double/.test(t) ? '<numericEdit/>' : /boolean/.test(t) ? '<checkButton size="3.5mm"/>' : '<textEdit/>';
    const fmt = /date/.test(t) ? '<format><picture>date{DD.MM.YYYY}</picture></format>' : /decimal|float|double/.test(t) ? '<format><picture>num{z,zzz,zz9.99}</picture></format><para hAlign="right" vAlign="middle"/>' : '';
    const nm = X.tpl.querySelector(`[name="${fld}"]`) ? uniqueName(fld) : fld;
    return fieldXml(nm, ui, words(fld), `${fmt}<bind match="dataRef" ref="${refFor(container, d.path)}"/>`, '90mm');
  }

  // ---------------------------------------------------------------- object library
  $('.fd-lib').innerHTML = LIBRARY.map(([g, items]) => `<div class="fd-lg">${g}</div><div class="fd-tiles">${items.map(([id, lbl, ic]) => `<div class="fd-tile" data-lib="${id}" title="Drag onto the page (double-click: add to the selected container or the body)"><span class="ic">${ic}</span>${lbl}</div>`).join('')}</div>`).join('');
  const libXml = id => { const it = LIBRARY.flatMap(([, l]) => l).find(x => x[0] === id); return it[4]().replace(/NAME/g, uniqueName(it[3])); };
  $('.fd-lib').addEventListener('dblclick', e => {
    const t = e.target.closest('.fd-tile'); if (!t || !X.doc) return;
    const s = nodeAt(X.sel);
    const target = s && ['subform', 'pageArea'].includes(tag(s)) ? s : bodyRoot();
    insertAt(target, libXml(t.dataset.lib), null, positioned(target) ? { x: 10, y: 10 } : null);
  });
  const bodyRoot = () => kid(X.tpl, 'subform');
  function insertAt(container, xml, before, pos) {
    let el;
    commit(() => {
      el = fromXml(xml);
      if (pos && positioned(container)) { el.setAttribute('x', mm(Math.max(0, pos.x))); el.setAttribute('y', mm(Math.max(0, pos.y))); }
      // a container's property elements come first; content after them (before a trailing event / pageSet stays fine)
      place(container, el, before);
    });
    if (el) select(pathOf(el));
  }

  // ---------------------------------------------------------------- dragging
  const pageAt = ev => { const el = document.elementFromPoint(ev.clientX, ev.clientY)?.closest?.('.fd-page'); if (!el || !host.contains(el)) return null; const r = el.getBoundingClientRect(), z = zoom(); return { el, pi: Number(el.dataset.page), x: (ev.clientX - r.left) / z, y: (ev.clientY - r.top) / z }; };
  // the container a drop at a page point goes into, its origin on the page, and the flowed sibling to insert before
  function dropTarget(pt, exclude) {
    const L = X.layout, pg = L.pages[pt.pi];
    const inside = b => pt.x >= b.x && pt.x <= b.x + b.w && pt.y >= b.y && pt.y <= b.y + b.h;
    const ok = b => b.page === pt.pi && !(exclude !== undefined && (b.path === exclude || b.path.startsWith(`${exclude}/`)));
    const conts = L.boxes.filter(b => ok(b) && ['subform', 'exclGroup', 'area'].includes(b.tag) && inside(b)).sort((a, b) => depth(b.path) - depth(a.path) || a.w * a.h - b.w * b.h);
    for (const b of conts) {
      const el = nodeAt(b.path);
      if (!el || el.getAttribute('layout') === 'table') continue;
      // a table row: a new cell (column) before the cell under the point
      if (el.getAttribute('layout') === 'row') {
        const cells = X.layout.boxes.filter(x => x.page === pt.pi && nodeAt(x.path)?.parentElement === el && Math.abs(x.y - b.y) < 2).sort((a, c) => a.x - c.x);
        const at = cells.find(c => c.x + c.w / 2 > pt.x);
        return { el, row: true, ox: b.x, oy: b.y, before: at ? nodeAt(at.path) : null, line: at ? { x: at.x, y: b.y, w: 2, v: b.h } : { x: b.x + b.w, y: b.y, w: 2, v: b.h } };
      }
      return { el, ox: b.x, oy: b.y, ...flowSpot(el, pt) };
    }
    const ca = pg.contentArea;
    if (pt.x >= ca.x && pt.x <= ca.x + ca.w && pt.y >= ca.y && pt.y <= ca.y + ca.h) { const root = bodyRoot(); return { el: root, ox: ca.x, oy: ca.y, ...flowSpot(root, pt) }; }
    return { el: nodeAt(pg.pageArea), ox: 0, oy: 0 };
  }
  // in a flowed container: before the first child whose box is below the point
  function flowSpot(el, pt) {
    if (positioned(el)) return {};
    const kidsB = X.layout.boxes.filter(b => b.page === pt.pi && nodeAt(b.path)?.parentElement === el);
    const below = kidsB.filter(b => b.y + b.h / 2 > pt.y).sort((a, b) => a.y - b.y)[0];
    return { before: below ? nodeAt(below.path) : null, line: below ? { x: below.x, y: below.y, w: below.w } : null };
  }
  let drag = null;
  function startDrag(e, what) {
    drag = { ...what, x0: e.clientX, y0: e.clientY, on: false };
    const mv = ev => {
      if (!drag) return;
      if (!drag.on && Math.hypot(ev.clientX - drag.x0, ev.clientY - drag.y0) < 4) return;
      if (!drag.on) { drag.on = true; document.body.classList.add('fd-dragging'); if (drag.label) { drag.ghost = document.createElement('div'); drag.ghost.className = 'fd-ghost'; drag.ghost.textContent = drag.label; document.body.appendChild(drag.ghost); } }
      if (drag.ghost) { drag.ghost.style.left = `${ev.clientX + 12}px`; drag.ghost.style.top = `${ev.clientY + 8}px`; }
      drag.move?.(ev);
      over(ev);
    };
    const up = ev => { document.removeEventListener('pointermove', mv); document.removeEventListener('pointerup', up); if (drag && !drag.on && Math.hypot(ev.clientX - drag.x0, ev.clientY - drag.y0) >= 4) { drag.on = true; drag.move?.(ev); } const d = drag; drag = null; document.body.classList.remove('fd-dragging'); d.ghost?.remove(); clearMarks(); if (d.on) d.drop(ev); else d.click?.(); };
    document.addEventListener('pointermove', mv); document.addEventListener('pointerup', up);
  }
  const clearMarks = () => canvas.querySelectorAll('.fd-ins,.fd-into').forEach(x => x.remove());
  function over(ev) {
    clearMarks();
    if (!drag?.insert && !drag?.reorder) return;
    const pt = pageAt(ev); if (!pt || !X.layout) return;
    const t = dropTarget(pt, drag.exclude);
    const ov = pt.el.querySelector('.fd-ov');
    const b = t.el && X.layout.boxes.find(x => x.page === pt.pi && x.path === pathOf(t.el));
    if (b) ov.insertAdjacentHTML('beforeend', `<div class="fd-into" style="left:${b.x}px;top:${b.y}px;width:${b.w}px;height:${b.h}px"></div>`);
    if (t.line) ov.insertAdjacentHTML('beforeend', t.line.v ? `<div class="fd-ins xd-vins" style="left:${t.line.x - 1}px;top:${t.line.y}px;height:${t.line.v}px"></div>` : `<div class="fd-ins" style="left:${t.line.x}px;top:${t.line.y - 1}px;width:${t.line.w}px"></div>`);
  }
  // library tiles and data view rows: insert where they are dropped
  host.addEventListener('pointerdown', e => {
    const tile = e.target.closest('.fd-tile, .fd-d[data-d]');
    if (!tile || !X.doc) return;
    e.preventDefault();
    const isLib = !!tile.dataset.lib;
    startDrag(e, {
      insert: true, label: isLib ? tile.textContent.trim() : `${tile.dataset.t === 'table' ? 'Table' : 'Field'}: ${tile.dataset.d}`,
      drop(ev) {
        const pt = pageAt(ev); if (!pt) return;
        const t = dropTarget(pt);
        if (!t.el) return;
        const xml = isLib ? libXml(tile.dataset.lib) : dataXml({ path: tile.dataset.d, type: tile.dataset.t }, t.el);
        if (t.row) return insertCell(t.el, xml, t.before || null);
        insertAt(t.el, xml, t.before || null, { x: pt.x - t.ox, y: pt.y - t.oy });
      },
    });
  });
  // objects on the page: select; drag to move (positioned) or reorder (flowed); handles resize
  canvas.addEventListener('pointerdown', e => {
    const box = e.target.closest('.fd-box');
    if (!box) { const pgEl = e.target.closest('.fd-page'); if (pgEl) rubberBand(e, pgEl); return; }
    e.preventDefault();
    canvas.focus({ preventScroll: true });
    const p = box.dataset.path, el = nodeAt(p);
    if (!el) return;
    const h = e.target.closest('.fd-h')?.dataset.h;
    const z = zoom();
    if (h) {
      const b0 = X.layout.boxes.find(b => b.path === p);
      startDrag(e, {
        move(ev) { const dx = (ev.clientX - drag.x0) / z, dy = (ev.clientY - drag.y0) / z; if (h !== 's') box.style.width = `${Math.max(2, b0.w + dx)}px`; if (h !== 'e') box.style.height = `${Math.max(2, b0.h + dy)}px`; },
        drop(ev) {
          const dx = (ev.clientX - drag?.x0 || 0), dy = 0; void dx; void dy;
          const w = parseFloat(box.style.width), hh = parseFloat(box.style.height);
          commit(() => {
            if (h !== 's') { el.setAttribute('w', mm(w)); el.removeAttribute('minW'); el.removeAttribute('maxW'); }
            if (h !== 'e') { if (el.hasAttribute('minH') && !el.hasAttribute('h')) el.setAttribute('minH', mm(hh)); else { el.setAttribute('h', mm(hh)); el.removeAttribute('minH'); el.removeAttribute('maxH'); } }
          });
        },
      });
      return;
    }
    if (e.shiftKey || e.metaKey || e.ctrlKey) return select(p, true, true);
    // several objects selected: move the positioned ones together
    if (X.multi.has(p) && X.multi.size > 1) {
      const items = [...X.multi].map(nodeAt).filter(x => x && containerOf(x) && positioned(containerOf(x)));
      const bx = [...X.multi].flatMap(q => [...canvas.querySelectorAll(`.fd-box[data-path="${q}"]`)]);
      startDrag(e, {
        move(ev) { const dx = (ev.clientX - drag.x0) / z, dy = (ev.clientY - drag.y0) / z; bx.forEach(b => { b.style.transform = `translate(${dx}px, ${dy}px)`; }); },
        drop(ev) {
          const dx = (ev.clientX - e.clientX) / z, dy = (ev.clientY - e.clientY) / z;
          if (Math.abs(dx) < 0.3 && Math.abs(dy) < 0.3) return;
          const keep = [...X.multi];
          commit(() => { for (const x of items) { x.setAttribute('x', mm(Math.max(0, toPt(x.getAttribute('x')) + dx))); x.setAttribute('y', mm(Math.max(0, toPt(x.getAttribute('y')) + dy))); } });
          X.multi = new Set(keep); markSel(); drawTree(false);
        },
        click() { select(p, true); },
      });
      return;
    }
    const cont = containerOf(el);
    const pos = cont && positioned(cont);
    const sel = () => { if (X.sel !== p) select(p, true); };
    sel();
    const boxesOf = [...canvas.querySelectorAll(`.fd-box[data-path="${p}"]`)];
    startDrag(e, {
      reorder: !pos, exclude: p, label: pos ? null : el.getAttribute('name') || label(el),
      move(ev) { if (!pos) return; const dx = (ev.clientX - drag.x0) / z, dy = (ev.clientY - drag.y0) / z; boxesOf.forEach(b => { b.style.transform = `translate(${dx}px, ${dy}px)`; }); },
      drop(ev) {
        if (pos) {
          const dx = (ev.clientX - (drag?.x0 ?? e.clientX)) / z, dy = (ev.clientY - (drag?.y0 ?? e.clientY)) / z;
          void dx; void dy;
          const ddx = (ev.clientX - e.clientX) / z, ddy = (ev.clientY - e.clientY) / z;
          if (Math.abs(ddx) < 0.3 && Math.abs(ddy) < 0.3) return;
          commit(() => { el.setAttribute('x', mm(Math.max(0, toPt(el.getAttribute('x')) + ddx))); el.setAttribute('y', mm(Math.max(0, toPt(el.getAttribute('y')) + ddy))); });
          return;
        }
        // flowed: a new place among the siblings (or into another container)
        const pt = pageAt(ev); if (!pt) return;
        const t = dropTarget(pt, p);
        if (!t.el || t.before === el) return;
        // a cell of a table row: its whole column moves (only within its own table)
        if (t.row || cont?.getAttribute('layout') === 'row') {
          if (!t.row || t.el !== cont) return;
          moveColumn(cont, cellsOf(cont).indexOf(el), t.before ? cellsOf(cont).indexOf(t.before) : cellsOf(cont).length);
          return;
        }
        commit(() => {
          remove(el);
          if (positioned(t.el)) { el.setAttribute('x', mm(Math.max(0, pt.x - t.ox))); el.setAttribute('y', mm(Math.max(0, pt.y - t.oy))); } else { el.removeAttribute('x'); el.removeAttribute('y'); }
          place(t.el, el, t.before && t.before.parentElement === t.el ? t.before : null);
        });
        select(pathOf(el));
      },
    });
  });

  // a frame dragged on the empty page: selects the objects inside it
  function rubberBand(e, pgEl) {
    const ov = pgEl.querySelector('.fd-ov'), z = zoom(), r0 = pgEl.getBoundingClientRect();
    const x0 = (e.clientX - r0.left) / z, y0 = (e.clientY - r0.top) / z, pi = Number(pgEl.dataset.page);
    let band = null;
    startDrag(e, {
      move(ev) {
        const x1 = (ev.clientX - r0.left) / z, y1 = (ev.clientY - r0.top) / z;
        if (!band) { band = document.createElement('div'); band.className = 'xd-band'; ov.appendChild(band); }
        Object.assign(band.style, { left: `${Math.min(x0, x1)}px`, top: `${Math.min(y0, y1)}px`, width: `${Math.abs(x1 - x0)}px`, height: `${Math.abs(y1 - y0)}px` });
      },
      drop(ev) {
        band?.remove();
        const x1 = (ev.clientX - r0.left) / z, y1 = (ev.clientY - r0.top) / z;
        const [l, t, rr, bb] = [Math.min(x0, x1), Math.min(y0, y1), Math.max(x0, x1), Math.max(y0, y1)];
        const hits = [...new Set(X.layout.boxes.filter(b => b.page === pi && ['field', 'draw', 'subform', 'exclGroup'].includes(b.tag) && b.x >= l && b.y >= t && b.x + b.w <= rr && b.y + b.h <= bb).map(b => b.path))];
        // only the outermost objects (a subform, not also its contents)
        const top = hits.filter(h => !hits.some(o => o !== h && h.startsWith(`${o}/`)));
        X.multi = new Set(top); X.sel = top.at(-1) ?? null; X.scriptEv = null;
        drawTree(true); drawProps(); markSel();
      },
      click() { select(null); },
    });
  }

  // ---- tables: the cells of a row, columns over all rows
  const cellsOf = row => kids(row).filter(k => ['field', 'draw', 'subform', 'exclGroup'].includes(tag(k)));
  const tableOf = el => { for (let p = el; p && p !== X.tpl; p = p.parentElement) if (tag(p) === 'subform' && p.getAttribute('layout') === 'table') return p; return null; };
  const tableRows = table => [...table.getElementsByTagNameNS('*', 'subform')].filter(s => s.getAttribute('layout') === 'row' && tableOf(s.parentElement) === table);
  const isHeadRow = row => kid(row, 'assist')?.getAttribute('role') === 'TH' || /head/i.test(row.getAttribute('name') || '');
  const widthsOf = table => (table.getAttribute('columnWidths') || '').split(/\s+/).filter(Boolean);
  const setWidths = (table, ws) => { table.setAttribute('columnWidths', ws.join(' ')); if (table.hasAttribute('w')) table.setAttribute('w', mm(ws.reduce((a, w) => a + toPt(w), 0))); };
  const headCell = text => fromXml(`<draw name="${uniqueName('Head')}" minH="7mm"><ui><textEdit/></ui><value><text>${esc(text)}</text></value><font typeface="Arial" size="9pt" weight="bold"/><margin topInset="0.5mm" bottomInset="0.5mm" leftInset="1mm" rightInset="1mm"/><para vAlign="middle"/></draw>`);
  const bodyCell = () => fromXml(`<field name="${uniqueName('Column')}" minH="6mm"><ui><textEdit/></ui><font typeface="Arial" size="9pt"/><margin topInset="0.5mm" bottomInset="0.5mm" leftInset="1mm" rightInset="1mm"/><para vAlign="middle"/></field>`);
  // an object as a table cell: no own position or width, no caption (the header row carries the text)
  function asCell(el) {
    for (const a of ['x', 'y', 'w', 'h', 'anchorType']) el.removeAttribute(a);
    if (!el.hasAttribute('minH')) el.setAttribute('minH', '6mm');
    const cap = kid(el, 'caption');
    const text = textOf(kid(kid(cap, 'value'), 'text')) || words(el.getAttribute('name') || '');
    cap?.remove();
    return text;
  }
  // a new column at index in every row of the table; cellFor(row) makes the row's cell
  function addColumnAt(table, index, cellFor, width = '30mm') {
    for (const row of tableRows(table)) { const cells = cellsOf(row); place(row, cellFor(row), cells[index] || null); }
    const ws = widthsOf(table); ws.splice(index, 0, width); setWidths(table, ws);
  }
  function insertCell(row, xml, before) {
    const table = tableOf(row);
    let cell;
    commit(() => {
      cell = fromXml(xml);
      const text = asCell(cell);
      if (!table) { place(row, cell, before); return; }
      const index = before ? cellsOf(row).indexOf(before) : cellsOf(row).length;
      addColumnAt(table, index, r => (r === row ? cell : isHeadRow(r) ? headCell(text) : fromXml('<draw minH="6mm"><ui><textEdit/></ui><value><text/></value></draw>')));
    });
    if (cell) select(pathOf(cell));
  }
  function moveColumn(row, from, to) {
    const table = tableOf(row);
    if (from < 0 || to === from || to === from + 1) return;
    let moved;
    commit(() => {
      for (const r of table ? tableRows(table) : [row]) {
        const cells = cellsOf(r), c = cells[from];
        if (!c) continue;
        const ref = cells[to] || null;
        remove(c); place(r, c, ref);
        if (r === row) moved = c;
      }
      if (table) { const ws = widthsOf(table); const [w] = ws.splice(from, 1); ws.splice(to > from ? to - 1 : to, 0, w); setWidths(table, ws); }
    });
    if (moved) select(pathOf(moved));
  }
  function tableAction(act) {
    const el = nodeAt(X.sel), table = tableOf(el);
    if (!table) return;
    let row = null;
    for (let p = el; p && p !== table; p = p.parentElement) if (p.getAttribute?.('layout') === 'row') { row = p; break; }
    const cellIdx = row ? cellsOf(row).findIndex(c => c === el || c.contains(el)) : -1;
    const n = Math.max(0, ...tableRows(table).map(r => cellsOf(r).length));
    if (act === 'addCol') return commit(() => addColumnAt(table, cellIdx >= 0 ? cellIdx + 1 : n, r => (isHeadRow(r) ? headCell(`Column ${n + 1}`) : bodyCell())));
    if (act === 'delCol') {
      const at = cellIdx >= 0 ? cellIdx : n - 1;
      if (n <= 1) return toast?.('A table needs at least one column');
      commit(() => { for (const r of tableRows(table)) { const c = cellsOf(r)[at]; if (c) remove(c); } const ws = widthsOf(table); ws.splice(at, 1); setWidths(table, ws); });
      return select(pathOf(table));
    }
    if (act === 'addRow') {
      const last = tableRows(table).at(-1);
      if (!last) return;
      let copy;
      commit(() => {
        copy = last.cloneNode(true);
        kid(copy, 'occur')?.remove(); kid(copy, 'bind')?.remove();
        copy.setAttribute('name', uniqueName('Row'));
        for (const c of cellsOf(copy)) {
          if (c.getAttribute('name')) c.setAttribute('name', uniqueName(c.getAttribute('name').replace(/\d+$/, '')));
          c.removeAttribute('id'); kid(c, 'bind')?.remove(); kid(c, 'calculate')?.remove();
          if (tag(c) === 'field') kid(c, 'value')?.remove();
        }
        place(last.parentElement, copy, last.nextElementSibling);
      });
      if (copy) select(pathOf(copy));
    }
  }

  // ---- several objects: align, distribute, same size (positioned objects; the boxes give their place on the page)
  function alignCmd(a) {
    const items = [...X.multi].map(p => ({ el: nodeAt(p), b: X.layout?.boxes.find(x => x.path === p) })).filter(i => i.el && i.b && containerOf(i.el) && positioned(containerOf(i.el)));
    if (items.length < 2) return toast?.('Select two or more positioned objects');
    const ref = items.find(i => pathOf(i.el) === X.sel) || items.at(-1);
    const L = Math.min(...items.map(i => i.b.x)), R = Math.max(...items.map(i => i.b.x + i.b.w)), T = Math.min(...items.map(i => i.b.y)), B = Math.max(...items.map(i => i.b.y + i.b.h));
    const move = (i, dx, dy) => { if (dx) i.el.setAttribute('x', mm(Math.max(0, toPt(i.el.getAttribute('x')) + dx))); if (dy) i.el.setAttribute('y', mm(Math.max(0, toPt(i.el.getAttribute('y')) + dy))); };
    const keep = [...X.multi];
    commit(() => {
      for (const i of items) {
        if (a === 'al') move(i, L - i.b.x, 0);
        if (a === 'ar') move(i, R - (i.b.x + i.b.w), 0);
        if (a === 'ach') move(i, (L + R) / 2 - (i.b.x + i.b.w / 2), 0);
        if (a === 'at') move(i, 0, T - i.b.y);
        if (a === 'ab') move(i, 0, B - (i.b.y + i.b.h));
        if (a === 'acv') move(i, 0, (T + B) / 2 - (i.b.y + i.b.h / 2));
        if (a === 'sw' && i !== ref) { i.el.setAttribute('w', mm(ref.b.w)); i.el.removeAttribute('minW'); i.el.removeAttribute('maxW'); }
        if (a === 'sh' && i !== ref) { i.el.setAttribute('h', mm(ref.b.h)); i.el.removeAttribute('minH'); i.el.removeAttribute('maxH'); }
      }
      if (a === 'dh' || a === 'dv') {
        const hz = a === 'dh';
        const s = [...items].sort((p, q) => (hz ? p.b.x - q.b.x : p.b.y - q.b.y));
        const total = s.reduce((n, i) => n + (hz ? i.b.w : i.b.h), 0), gap = ((hz ? R - L : B - T) - total) / (s.length - 1);
        let pos = hz ? L : T;
        for (const i of s) { if (hz) move(i, pos - i.b.x, 0); else move(i, 0, pos - i.b.y); pos += (hz ? i.b.w : i.b.h) + gap; }
      }
    });
    X.multi = new Set(keep); markSel(); drawTree(false);
  }

  // ---- copy and paste (also between forms): the objects' XML on the clipboard, a copy in localStorage
  const CLIP = '<!--rapstudio-xfa-->';
  function copySel() {
    const els = [...X.multi].map(nodeAt).filter(e => e && ['field', 'draw', 'subform', 'exclGroup'].includes(tag(e)));
    const top = els.filter(e => !els.some(o => o !== e && o.contains(e)));
    if (!top.length) return;
    const text = CLIP + top.map(e => new XMLSerializer().serializeToString(e).replace(/^(<[\w:-]+) xmlns="[^"]*"/, '$1')).join('');
    try { localStorage.setItem('rapstudio.xfa.clip', text); } catch {}
    navigator.clipboard?.writeText(text).catch(() => {});
    toast?.(`${top.length} object${top.length > 1 ? 's' : ''} copied`);
  }
  async function pasteClip() {
    let text = null;
    try { text = await navigator.clipboard.readText(); } catch {}
    if (!text?.startsWith(CLIP)) { try { text = localStorage.getItem('rapstudio.xfa.clip'); } catch {} }
    if (!text?.startsWith(CLIP) || !X.doc) return;
    const d = new DOMParser().parseFromString(`<x xmlns="${X.tpl.namespaceURI}">${text.slice(CLIP.length)}</x>`, 'application/xml');
    if (d.querySelector('parsererror')) return;
    const okCont = c => c && ['subform', 'pageArea', 'area', 'exclGroup'].includes(tag(c)) && !['table', 'row'].includes(c.getAttribute('layout'));
    const s = nodeAt(X.sel);
    const target = okCont(s) ? s : okCont(containerOf(s)) ? containerOf(s) : bodyRoot();
    const ids = new Set([...X.tpl.getElementsByTagNameNS('*', '*')].map(e => e.getAttribute('id')).filter(Boolean));
    const added = [];
    commit(() => {
      for (const src of [...d.documentElement.children]) {
        const el = X.doc.importNode(src, true);
        for (const n of [el, ...el.getElementsByTagNameNS('*', '*')]) {
          // the namespace declarations of the copied XML: the template's default namespace is in scope already
          if (n.namespaceURI === X.tpl.namespaceURI) n.removeAttributeNS('http://www.w3.org/2000/xmlns/', 'xmlns');
          if (n.getAttribute('name') && ['field', 'draw', 'subform', 'exclGroup'].includes(tag(n))) n.setAttribute('name', uniqueName(n.getAttribute('name').replace(/\d+$/, '')));
          if (n.getAttribute('id') && ids.has(n.getAttribute('id'))) n.removeAttribute('id');
        }
        if (positioned(target)) { el.setAttribute('x', mm(toPt(el.getAttribute('x')) + 14)); el.setAttribute('y', mm(toPt(el.getAttribute('y')) + 14)); }
        else { el.removeAttribute('x'); el.removeAttribute('y'); }
        place(target, el, null);
        added.push(el);
      }
    });
    if (added.length) { X.multi = new Set(added.map(pathOf)); X.sel = pathOf(added.at(-1)); X.scriptEv = null; drawTree(true); drawProps(); markSel(); }
  }

  // ---------------------------------------------------------------- properties
  const PAGE_SIZES = { a4: [210, 297], letter: [215.9, 279.4], legal: [215.9, 355.6], a5: [148, 210], a3: [297, 420] };
  function drawProps() {
    const el = nodeAt(X.sel);
    const P = $('.fd-props');
    if (!X.tpl) { P.innerHTML = ''; return; }
    if (!el || X.sel === null) { $('.fd-ptitle').textContent = 'Form'; P.innerHTML = formProps(); P.querySelectorAll('[data-open]').forEach(b => { b.onclick = () => openFile?.(b.dataset.open); }); return; }
    if (X.multi.size > 1) { $('.fd-ptitle').textContent = `${X.multi.size} objects`; P.innerHTML = `<p class="fd-note">${X.multi.size} objects selected. Align and distribute them with the toolbar (positioned objects), move them together on the page or with the arrow keys, copy (Ctrl+C) and paste (Ctrl+V) them, or delete them.</p>`; return; }
    const t = tag(el);
    $('.fd-ptitle').textContent = label(el);
    if (t === 'pageArea') { const i = pageAreas().indexOf(el); P.innerHTML = `<div class="fd-path">${esc(somOf(el))}</div>${pageAreaProps(el, i)}`; return; }
    const f = (lbl, html, hint) => `<div class="fd-f"><label${hint ? ` title="${esc(hint)}"` : ''}>${lbl}</label>${html}</div>`;
    const inp = (k, v, attrs = '') => `<input data-k="${k}" value="${esc(v ?? '')}" ${attrs}>`;
    const sel = (k, v, opts) => `<select data-k="${k}">${opts.map(o => (Array.isArray(o) ? o : [o, o])).map(([val, l]) => `<option value="${esc(val)}"${String(v) === String(val) ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
    const out = [`<div class="fd-path">${esc(somOf(el))}</div>`];
    if (el.hasAttribute('name') || CONTENT.has(t)) out.push(f('Name', inp('@name', el.getAttribute('name'))));
    if (['field', 'draw', 'subform', 'exclGroup', 'contentArea'].includes(t)) {
      const cont = containerOf(el);
      const pos = t === 'contentArea' || (cont && positioned(cont));
      out.push(`<div class="fd-sub">Layout</div><div class="fd-grid xd-g4">${pos ? `<label>X</label>${inp('@x', toMm(el.getAttribute('x')), 'type="number" step="0.5"')}<label>Y</label>${inp('@y', toMm(el.getAttribute('y')), 'type="number" step="0.5"')}` : ''}
        <label>Width</label>${inp('@w', el.hasAttribute('w') ? toMm(el.getAttribute('w')) : '', 'type="number" step="0.5" placeholder="auto"')}<label>Height</label>${inp('@h', el.hasAttribute('h') ? toMm(el.getAttribute('h')) : '', `type="number" step="0.5" placeholder="${el.hasAttribute('minH') ? `≥ ${toMm(el.getAttribute('minH'))}` : 'auto'}"`)}</div>
        <div class="fd-f"><label class="chk" title="The height grows with the content (minH)"><input type="checkbox" data-k="grow"${!el.hasAttribute('h') ? ' checked' : ''}> Expand to fit (height)</label></div>`);
      if (t !== 'contentArea') out.push(f('Presence', sel('@presence', el.getAttribute('presence') || 'visible', [['visible', 'Visible'], ['invisible', 'Invisible (keeps its space)'], ['hidden', 'Hidden (excluded from layout)']])));
    }
    if (t === 'draw') {
      const v = kid(kid(el, 'value'), null);
      if (v && tag(v) === 'exData') out.push(f('Text (rich text)', richEditor('text', v)));
      else if (!v || tag(v) === 'text') out.push(f('Text', `<textarea data-k="text" rows="3">${esc(textOf(v))}</textarea><button class="btn sm xd-mini" data-act="toRich" data-rt="text" title="Bold / italic / sizes / colours / floating fields in the text">Rich text…</button>`));
      if (v && ['line', 'rectangle', 'arc'].includes(tag(v))) out.push(f('Line thickness (pt)', inp('edge', toPt(kid(v, 'edge')?.getAttribute('thickness') || '0.5pt'), 'type="number" step="0.25" min="0"')));
      if (v && tag(v) === 'image') out.push(f('Image file', inp('href', v.getAttribute('href')), 'A file in the src folder (PNG, JPEG, SVG)'));
    }
    if (t === 'field') {
      const ui = kid(kid(el, 'ui'), null), ut = tag(ui) || 'textEdit';
      const cap = kid(el, 'caption');
      out.push(`<div class="fd-sub">Field</div>`);
      const capEx = kid(kid(cap, 'value'), 'exData');
      out.push(capEx ? f('Caption (rich text)', richEditor('caption', capEx)) : f('Caption', `${inp('caption', textOf(kid(kid(cap, 'value'), 'text')))}<button class="btn sm xd-mini" data-act="toRich" data-rt="caption">Rich text…</button>`));
      out.push(`<div class="fd-grid xd-g4"><label>Placement</label>${sel('capPlace', cap?.getAttribute('placement') || 'left', ['left', 'top', 'right', 'bottom'])}<label>Reserve</label>${inp('capReserve', cap?.hasAttribute('reserve') ? toMm(cap.getAttribute('reserve')) : '', 'type="number" step="1" placeholder="auto"')}</div>`);
      if (ut === 'barcode') out.push(f('Barcode type', sel('bcType', ui.getAttribute('type') || 'code128', ['QRCode', 'dataMatrix', 'pdf417', 'aztec', 'code128', 'code128A', 'code128B', 'code3Of9', 'ean13', 'ean8', 'upcA', 'code2Of5Interleaved', 'codabar'])));
      if (ut === 'textEdit') out.push(`<div class="fd-f"><label class="chk"><input type="checkbox" data-k="multiLine"${ui?.getAttribute('multiLine') === '1' ? ' checked' : ''}> Multiple lines</label></div>`);
      const pic = textOf(kid(kid(el, 'format'), 'picture'));
      if (!['checkButton', 'imageEdit', 'signature', 'barcode'].includes(ut)) out.push(f('Display pattern', inp('picture', pic, 'class="mono" placeholder="num{z,zzz,zz9.99}  date{DD.MM.YYYY}"'), 'XFA picture clause'));
      const val = kid(kid(el, 'value'), null);
      out.push(f('Default value', inp('default', val ? textOf(val) : '')));
      out.push(`<div class="fd-f"><label class="chk" title="Fillable when the form is interactive"><input type="checkbox" data-k="readOnly"${['readOnly', 'protected', 'nonInteractive'].includes(el.getAttribute('access')) ? ' checked' : ''}> Read only</label></div>`);
    }
    if (['field', 'subform', 'exclGroup'].includes(t)) {
      const b = kid(el, 'bind');
      out.push(`<div class="fd-sub">Binding</div>`);
      out.push(f('Data binding', sel('match', b?.getAttribute('match') || 'once', [['once', 'Normal (by name)'], ['dataRef', 'Data reference'], ['global', 'Global'], ['none', 'No data binding']])));
      if (b?.getAttribute('match') === 'dataRef') out.push(f('Reference', inp('ref', b.getAttribute('ref'), 'class="mono" placeholder="$.Header.Name"'), 'SOM expression of the data, relative to the subform\'s data ($.…) or absolute ($record.…)'));
    }
    if (t === 'subform') {
      const occ = kid(el, 'occur');
      out.push(`<div class="fd-sub">Subform</div>`);
      out.push(f('Content', sel('layout', el.getAttribute('layout') || 'position', [['position', 'Positioned'], ['tb', 'Flowed top to bottom'], ['lr-tb', 'Flowed left to right'], ['table', 'Table'], ['row', 'Table row']])));
      if (el.getAttribute('layout') === 'table') out.push(f('Column widths (mm)', inp('cols', (el.getAttribute('columnWidths') || '').split(/\s+/).filter(Boolean).map(toMm).join(' '), 'class="mono"')));
      out.push(`<div class="fd-f"><label class="chk" title="One instance per data record (occur max -1)"><input type="checkbox" data-k="repeat"${occ?.getAttribute('max') === '-1' || Number(occ?.getAttribute('max')) > 1 ? ' checked' : ''}> Repeat for each data item</label></div>`);
      out.push(`<div class="fd-f"><label class="chk" title="Keep together on one page"><input type="checkbox" data-k="keep"${kid(el, 'keep')?.getAttribute('intact') === 'contentArea' ? ' checked' : ''}> Allow no page break inside</label></div>`);
    }
    if (['field', 'draw'].includes(t)) {
      const fn = kid(el, 'font'), para = kid(el, 'para');
      out.push(`<div class="fd-sub">Font and paragraph</div><div class="fd-grid xd-g4"><label>Font</label>${sel('typeface', fn?.getAttribute('typeface') || 'Arial', ['Arial', 'Helvetica', 'Times New Roman', 'Courier New', 'Verdana', 'Calibri', '72', '72 Brand', 'Myriad Pro'])}<label>Size</label>${inp('size', toPt(fn?.getAttribute('size') || '10pt'), 'type="number" step="0.5" min="4"')}</div>
        <div class="fd-f xd-row"><label class="chk"><input type="checkbox" data-k="bold"${fn?.getAttribute('weight') === 'bold' ? ' checked' : ''}> Bold</label><label class="chk"><input type="checkbox" data-k="italic"${fn?.getAttribute('posture') === 'italic' ? ' checked' : ''}> Italic</label>
        ${sel('hAlign', para?.getAttribute('hAlign') || 'left', [['left', 'Left'], ['center', 'Center'], ['right', 'Right'], ['justify', 'Justify']])}</div>
        ${f('Colour', `<input type="color" data-k="color" value="${rgbHex(kid(kid(fn, 'fill'), 'color')?.getAttribute('value'))}">`)}`);
      const bd = kid(el, 'border');
      out.push(`<div class="fd-f"><label class="chk"><input type="checkbox" data-k="border"${bd && bd.getAttribute('presence') !== 'hidden' && kids(bd, 'edge').some(e => e.getAttribute('presence') !== 'hidden') ? ' checked' : ''}> Border</label></div>`);
    }
    // a table, one of its rows or cells: columns and rows
    if (tableOf(el)) out.push(`<div class="fd-sub">Table ${esc(tableOf(el).getAttribute('name') || '')}</div><div class="fd-f xd-row"><button class="btn sm" data-act="addCol" title="A new column after the selected cell (or at the end)">+ Column</button><button class="btn sm" data-act="delCol" title="Delete the selected cell's column (or the last one)">− Column</button><button class="btn sm" data-act="addRow" title="A new row like the last one (static)">+ Row</button></div>`);
    if (['field', 'subform', 'draw', 'exclGroup'].includes(t)) {
      const has = EVENTS.filter(([ev]) => scriptOf(el, ev));
      const ev = X.scriptEv || has[0]?.[0] || 'calculate';
      X.scriptEv = ev;
      const cs = scriptOf(el, ev);
      const lang = /javascript/.test(cs?.getAttribute('contentType') || '') ? 'js' : 'formcalc';
      out.push(`<div class="fd-sub">Scripts${has.length ? ` <small>(${has.length})</small>` : ''}</div>
        <div class="fd-grid xd-g4"><label>Event</label><select data-k="scriptEv">${EVENTS.map(([v, l]) => `<option value="${v}"${v === ev ? ' selected' : ''}>${scriptOf(el, v) ? '● ' : ''}${l}</option>`).join('')}</select><label>Language</label>${sel('scriptLang', lang, [['formcalc', 'FormCalc'], ['js', 'JavaScript']])}</div>
        <div class="fd-f"><textarea data-k="script" class="mono" rows="4" placeholder="${esc(SCRIPT_HINT[ev] || '')}">${esc(cs ? textOf(cs) : '')}</textarea></div>
        ${ev === 'validate' ? f('Message when it fails', inp('vmsg', textOf(kid(kid(kid(el, 'validate'), 'message'), 'text')))) : ''}`);
    }
    P.innerHTML = out.join('');
    P.querySelectorAll('.xd-rt').forEach(mountRich);
  }
  // ---- master pages (page areas): paper, orientation, margins (= the content area), how often it is used
  const pageAreas = () => [...X.tpl.getElementsByTagNameNS('*', 'pageArea')];
  const pageDims = pa => { const med = kid(pa, 'medium'); let w = toPt(med?.getAttribute('short') || '210mm'), h = toPt(med?.getAttribute('long') || '297mm'); if (med?.getAttribute('orientation') === 'landscape') [w, h] = [h, w]; return { w, h }; };
  const marginsOf = pa => { const { w, h } = pageDims(pa), ca = kid(pa, 'contentArea'); const x = toPt(ca?.getAttribute('x')), y = toPt(ca?.getAttribute('y')), cw = toPt(ca?.getAttribute('w'), w - x), ch = toPt(ca?.getAttribute('h'), h - y); return { l: x, t: y, r: w - x - cw, b: h - y - ch }; };
  const setMargins = (pa, m) => { const { w, h } = pageDims(pa), ca = ensure(pa, 'contentArea'); ca.setAttribute('x', mm(m.l)); ca.setAttribute('y', mm(m.t)); ca.setAttribute('w', mm(Math.max(10, w - m.l - m.r))); ca.setAttribute('h', mm(Math.max(10, h - m.t - m.b))); };
  function pageAreaProps(pa, i) {
    const med = kid(pa, 'medium');
    const short = toMm(med?.getAttribute('short') || '210mm'), long = toMm(med?.getAttribute('long') || '297mm');
    const size = Object.entries(PAGE_SIZES).find(([, [a, b]]) => Math.abs(a - short) < 0.6 && Math.abs(b - long) < 0.6)?.[0] || 'custom';
    const m = marginsOf(pa), mx = v => Math.round(v * 25.4 / 72 * 10) / 10;
    const once = kid(pa, 'occur')?.getAttribute('max') === '1';
    return `<div class="fd-sub">Master page ${i + 1}</div>
      <div class="fd-f"><label>Name</label><input data-k="pa:${i}:name" value="${esc(pa.getAttribute('name') || '')}"></div>
      <div class="fd-grid xd-g4"><label>Paper</label><select data-k="pa:${i}:paper">${[...Object.keys(PAGE_SIZES), 'custom'].map(k => `<option${k === size ? ' selected' : ''} value="${k}">${k === 'custom' ? `${short} × ${long}` : k.toUpperCase()}</option>`).join('')}</select>
        <label>Turn</label><select data-k="pa:${i}:orient"><option value="portrait">Portrait</option><option value="landscape"${med?.getAttribute('orientation') === 'landscape' ? ' selected' : ''}>Landscape</option></select></div>
      <div class="fd-grid xd-g4" title="Margins of the content area (mm)"><label>Left</label><input type="number" step="1" data-k="pa:${i}:ml" value="${mx(m.l)}"><label>Top</label><input type="number" step="1" data-k="pa:${i}:mt" value="${mx(m.t)}"><label>Right</label><input type="number" step="1" data-k="pa:${i}:mr" value="${mx(m.r)}"><label>Bottom</label><input type="number" step="1" data-k="pa:${i}:mb" value="${mx(m.b)}"></div>
      <div class="fd-f"><label>Used for</label><select data-k="pa:${i}:occur"><option value="repeat">As many pages as needed</option><option value="once"${once ? ' selected' : ''}>One page, then the next master page</option></select></div>`;
  }
  // a new master page like the first one; the first one is then used for one page (first page / following pages)
  function addMasterPage() {
    const all = pageAreas(), first = all[0], last = all.at(-1);
    if (!first) return;
    let pa;
    commit(() => {
      const nm = uniqueName('Page');
      pa = fromXml(`<pageArea name="${nm}" id="${nm}"/>`);
      const ca = kid(first, 'contentArea'), md = kid(first, 'medium');
      if (ca) pa.appendChild(ca.cloneNode(false));
      if (md) pa.appendChild(md.cloneNode(false));
      if (!kid(first, 'occur')) place(first, fromXml('<occur max="1"/>'), first.firstElementChild);
      place(last.parentElement, pa, last.nextElementSibling);
    });
    if (pa) select(pathOf(pa));
  }

  // ---- scripts of an object: calculate, validate and the events (with the reference XFA gives them)
  const EVENTS = [['calculate', 'Calculate'], ['validate', 'Validate'], ['initialize', 'Initialize'], ['form:ready', 'Form ready'], ['layout:ready', 'Layout ready'], ['docReady', 'Document ready'], ['prePrint', 'Pre-print'], ['click', 'Click'], ['change', 'Change'], ['enter', 'Enter'], ['exit', 'Exit']];
  const EVMAP = { initialize: ['initialize', '$'], 'form:ready': ['ready', '$form'], 'layout:ready': ['ready', '$layout'], docReady: ['docReady', '$host'], prePrint: ['prePrint', '$host'], click: ['click', '$'], change: ['change', '$'], enter: ['enter', '$'], exit: ['exit', '$'] };
  const SCRIPT_HINT = { calculate: 'Sum(Table1.Row1[*].Amount)', validate: 'this.rawValue > 0   (false: the validation fails)', initialize: 'if (this.isNull) this.presence = "hidden";', 'form:ready': 'Banner.presence = Total.rawValue > 1000 ? "visible" : "hidden";', 'layout:ready': '"Page " + xfa.layout.page(this)', docReady: '', prePrint: 'this.presence = "visible";', click: 'Runs in Adobe Reader (interactive forms)', change: 'Runs in Adobe Reader (interactive forms)', enter: 'Runs in Adobe Reader (interactive forms)', exit: 'Runs in Adobe Reader (interactive forms)' };
  const eventOf = (el, ev) => { const [act, ref] = EVMAP[ev] || []; return act ? kids(el, 'event').find(x => (x.getAttribute('activity') || 'click') === act && (x.getAttribute('ref') || '$') === ref) || null : null; };
  function scriptOf(el, ev) {
    if (ev === 'calculate') return kid(kid(el, 'calculate'), 'script');
    if (ev === 'validate') return kid(kid(el, 'validate'), 'script');
    return kid(eventOf(el, ev), 'script');
  }
  function setScript(el, ev, text, lang) {
    if (!ev) return false;
    if (!String(text).trim()) {
      if (ev === 'calculate') kid(el, 'calculate')?.remove();
      else if (ev === 'validate') { const v = kid(el, 'validate'); kid(v, 'script')?.remove(); if (v && !v.children.length && !v.attributes.length) v.remove(); }
      else eventOf(el, ev)?.remove();
      return;
    }
    let sc;
    if (ev === 'calculate' || ev === 'validate') sc = ensure(el, ev, 'script');
    else {
      let e = eventOf(el, ev);
      if (!e) { const [act, ref] = EVMAP[ev]; e = fromXml(`<event activity="${act}"${ref !== '$' ? ` ref="${ref}"` : ''}><script/></event>`); place(el, e, null); }
      sc = ensure(e, 'script');
    }
    setTextOf(sc, text);
    if (lang === 'js') sc.setAttribute('contentType', 'application/x-javascript'); else sc.removeAttribute('contentType');
  }

  // ---- rich text (exData XHTML): bold / italic / underline, sizes, colours and floating fields
  const XHTML = 'http://www.w3.org/1999/xhtml', XFAD = 'http://www.xfa.org/schema/xfa-data/1.0/';
  const xesc = v => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const fieldById = id => [...X.tpl.getElementsByTagNameNS('*', 'field')].find(f => f.getAttribute('id') === id);
  const chipOf = (ref, nm) => { const c = document.createElement('span'); c.className = 'xd-ff'; c.contentEditable = 'false'; c.dataset.embed = ref; c.textContent = `{${nm}}`; return c; };
  // the exData's XHTML as editable HTML (floating fields as chips)
  function richHtml(ex) {
    const body = [...ex.getElementsByTagNameNS('*', 'body')][0] || ex;
    const tmp = document.createElement('div');
    tmp.innerHTML = [...body.childNodes].map(n => (n.nodeType === 1 ? new XMLSerializer().serializeToString(n) : n.nodeType === 3 ? xesc(n.data) : '')).join('');
    for (const sp of [...tmp.querySelectorAll('*')].filter(e => [...e.attributes].some(a => /(^|:)embed$/i.test(a.name)))) {
      const ref = [...sp.attributes].find(a => /(^|:)embed$/i.test(a.name)).value;
      const f = /^#/.test(ref) ? fieldById(ref.slice(1)) : null;
      sp.replaceWith(chipOf(ref, f?.getAttribute('name') || ref));
    }
    tmp.querySelectorAll('[xmlns]').forEach(e => e.removeAttribute('xmlns'));
    return tmp.innerHTML;
  }
  function richEditor(kind, ex) {
    const fields = [...X.tpl.getElementsByTagNameNS('*', 'field')].filter(f => f.getAttribute('name'));
    return `<div class="xd-rt" data-rt="${kind}"><div class="xd-rt-bar">
      <button type="button" data-rc="bold" title="Bold"><b>B</b></button><button type="button" data-rc="italic" title="Italic"><i>I</i></button><button type="button" data-rc="underline" title="Underline"><u>U</u></button>
      <select data-rc="size" title="Font size of the selected text"><option value="">pt</option>${[7, 8, 9, 10, 11, 12, 14, 16, 18, 20, 24].map(n => `<option>${n}</option>`).join('')}</select>
      <input type="color" data-rc="color" title="Colour of the selected text" value="#000000">
      <select data-rc="field" title="Insert a floating field: its value in the text"><option value="">{field}</option>${fields.map(f => `<option value="${esc(pathOf(f))}">${esc(f.getAttribute('name'))}</option>`).join('')}</select>
      </div><div class="xd-rt-ed" contenteditable="true" spellcheck="false">${richHtml(ex)}</div></div>`;
  }
  // editable HTML -> XHTML body (paragraphs, spans with CSS, floating fields)
  function toXhtml(ed) {
    const ser = n => {
      if (n.nodeType === 3) return xesc(n.data);
      if (n.nodeType !== 1) return '';
      if (n.classList.contains('xd-ff')) return `<span xfa:embed="${xesc(n.dataset.embed)}" xfa:embedType="uri" xfa:embedMode="raw"/>`;
      const t = n.localName, inner = [...n.childNodes].map(ser).join('');
      if (t === 'br') return '<br/>';
      const css = [String(n.getAttribute('style') || '').trim().replace(/;\s*$/, '')];
      if (t === 'b' || t === 'strong') css.push('font-weight:bold');
      if (t === 'i' || t === 'em') css.push('font-style:italic');
      if (t === 'u') css.push('text-decoration:underline');
      if (t === 'font' && n.getAttribute('color')) css.push(`color:${n.getAttribute('color')}`);
      const style = css.filter(Boolean).join(';').replace(/font-size:\s*([\d.]+)px/g, (_, v) => `font-size:${Math.round(v * 7.5) / 10}pt`);
      const st = style ? ` style="${xesc(style)}"` : '';
      return t === 'div' || t === 'p' ? `<p${st}>${inner}</p>` : `<span${st}>${inner}</span>`;
    };
    const out = [];
    let line = '';
    for (const n of ed.childNodes) {
      if (n.nodeType === 1 && (n.localName === 'div' || n.localName === 'p')) { if (line) { out.push(`<p>${line}</p>`); line = ''; } out.push(ser(n)); }
      else line += ser(n);
    }
    if (line || !out.length) out.push(`<p>${line}</p>`);
    return `<body xmlns="${XHTML}" xmlns:xfa="${XFAD}">${out.join('')}</body>`;
  }
  function writeRich(kind, ed) {
    const el = nodeAt(X.sel);
    if (!el) return;
    const body = new DOMParser().parseFromString(toXhtml(ed), 'application/xml').documentElement;
    if (body.localName !== 'body') return;
    commit(() => {
      const ex = kind === 'caption' ? kid(kid(kid(el, 'caption'), 'value'), 'exData') : kid(kid(el, 'value'), 'exData');
      if (!ex) return false;
      while (ex.firstChild) ex.firstChild.remove();
      ex.setAttribute('contentType', 'text/html');
      ex.appendChild(X.doc.importNode(body, true));
    }, `rich|${X.sel}|${kind}`);
  }
  // plain text -> rich text
  function toRich(kind) {
    const el = nodeAt(X.sel);
    if (!el) return;
    commit(() => {
      const val = kind === 'caption' ? ensure(el, 'caption', 'value') : ensure(el, 'value');
      const text = textOf(kid(val, 'text'));
      [...val.children].forEach(c => c.remove());
      const ex = X.doc.importNode(new DOMParser().parseFromString(`<exData xmlns="${X.tpl.namespaceURI}" contentType="text/html"><body xmlns="${XHTML}" xmlns:xfa="${XFAD}">${String(text).split('\n').map(l => `<p>${xesc(l)}</p>`).join('')}</body></exData>`, 'application/xml').documentElement, true);
      ex.removeAttributeNS('http://www.w3.org/2000/xmlns/', 'xmlns');
      val.appendChild(ex);
    });
  }
  function mountRich(box) {
    const ed = box.querySelector('.xd-rt-ed'), kind = box.dataset.rt;
    let range = null, timer2 = null;
    const save = () => { const s = getSelection(); if (s.rangeCount && ed.contains(s.anchorNode)) range = s.getRangeAt(0).cloneRange(); };
    const restore = () => { if (!range) return; const s = getSelection(); s.removeAllRanges(); s.addRange(range); };
    const changed = () => { clearTimeout(timer2); timer2 = setTimeout(() => writeRich(kind, ed), 350); };
    ed.addEventListener('keyup', save); ed.addEventListener('mouseup', save);
    ed.addEventListener('input', () => { save(); changed(); });
    box.querySelector('.xd-rt-bar').addEventListener('mousedown', e => { if (e.target.closest('button')) e.preventDefault(); });
    box.querySelectorAll('button[data-rc]').forEach(b => b.addEventListener('click', () => { restore(); document.execCommand('styleWithCSS', false, true); document.execCommand(b.dataset.rc); save(); changed(); }));
    box.querySelector('[data-rc="color"]').addEventListener('input', e => { restore(); document.execCommand('styleWithCSS', false, true); document.execCommand('foreColor', false, e.target.value); save(); changed(); });
    box.querySelector('[data-rc="size"]').addEventListener('change', e => {
      const pt = e.target.value; e.target.value = '';
      save();
      if (!pt || !range || range.collapsed) return toast?.('Select the text first');
      restore();
      const r = range.cloneRange();
      const span = document.createElement('span'); span.style.fontSize = `${pt}pt`;
      span.appendChild(r.extractContents()); r.insertNode(span);
      const s = getSelection(); s.removeAllRanges(); const nr = document.createRange(); nr.selectNodeContents(span); s.addRange(nr);
      save(); changed();
    });
    box.querySelector('[data-rc="field"]').addEventListener('change', e => {
      const f = nodeAt(e.target.value); e.target.value = '';
      if (!f) return;
      // the floating field needs an id the text refers to
      if (!f.getAttribute('id')) {
        const ids = new Set([...X.tpl.getElementsByTagNameNS('*', '*')].map(x => x.getAttribute('id')).filter(Boolean));
        let id = f.getAttribute('name');
        for (let i = 1; ids.has(id); i++) id = `${f.getAttribute('name')}${i}`;
        f.setAttribute('id', id);
      }
      const chip = chipOf(`#${f.getAttribute('id')}`, f.getAttribute('name'));
      // at the caret; at the very end of the editor: into its last paragraph
      if (range && range.startContainer === ed && range.collapsed && ed.lastElementChild && /^(p|div)$/i.test(ed.lastElementChild.localName)) { range.selectNodeContents(ed.lastElementChild); range.collapse(false); }
      if (range) { restore(); range.deleteContents(); range.insertNode(document.createTextNode(' ')); range.insertNode(chip); range.setStartAfter(chip); range.collapse(true); } else (ed.lastElementChild || ed).appendChild(chip);
      save(); writeRich(kind, ed);
    });
  }

  function formProps() {
    const root = bodyRoot();
    return `<div class="fd-path">${esc(name)}.xdp${X.fdp ? ` · data provider ${esc(String(X.fdp).toUpperCase())}` : X.itf ? ` · form interface ${esc(String(X.itf).toUpperCase())}` : ''}</div>
      ${openFile ? `<div class="fd-f"><button class="btn sm" data-open="src/${esc(String(name).toLowerCase())}.form.json" title="Title, data provider or form interface, sample data">Form object…</button>${X.itf ? `<button class="btn sm" data-open="src/${esc(String(X.itf).toLowerCase())}.sfpi.json" title="Import parameters, global data, initialization">Form interface…</button>` : ''}</div>` : ''}
      ${pageAreas().map((pa, i) => pageAreaProps(pa, i)).join('')}
      <div class="fd-f"><button class="btn sm" data-act="addPage" title="A new master page (e.g. for the following pages: the first one is then used once)">+ Master page</button></div>
      <div class="fd-sub">Body</div>
      <div class="fd-f"><label>Content</label><select data-k="rootLayout"><option value="position">Positioned</option><option value="tb"${root?.getAttribute('layout') === 'tb' ? ' selected' : ''}>Flowed (grows over pages)</option></select></div>
      <div class="fd-f"><label>Locale</label><input data-k="locale" value="${esc(root?.getAttribute('locale') || '')}" placeholder="en_US, de_DE …"></div>
      <p class="fd-note">Drag objects from the Object Library and fields or tables from the Data View onto the page (into a table row: a new column). Select an object to change it; drag to move, the handles resize; Shift / Cmd + click or a frame dragged on the page selects several. Objects on a master page appear on every page that uses it.</p>`;
  }
  const rgbHex = v => { const p = String(v || '0,0,0').split(',').map(Number); return `#${p.slice(0, 3).map(x => Math.max(0, Math.min(255, x || 0)).toString(16).padStart(2, '0')).join('')}`; };
  const hexRgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)).join(',');
  const somOf = el => { const s = []; for (let n = el; n && n !== X.tpl; n = n.parentElement) if (n.getAttribute('name')) s.unshift(n.getAttribute('name')); return s.join('.') || label(el); };

  function setProp(k, v, input) {
    const el = nodeAt(X.sel);
    const key = `${k}|${X.sel}`;
    if (k === 'scriptEv') { X.scriptEv = v; return drawProps(); }
    if (!el || k.startsWith('pa:')) return setFormProp(k, v);
    const num = Number(v);
    commit(() => {
      if (k.startsWith('@')) {
        const a = k.slice(1);
        if (['x', 'y', 'w', 'h'].includes(a)) { if (v === '') { if (a !== 'x' && a !== 'y') el.removeAttribute(a); } else el.setAttribute(a, `${num}mm`); if (a === 'h' && v !== '') el.removeAttribute('minH'); }
        else if (a === 'presence' && v === 'visible') el.removeAttribute('presence');
        else if (v === '') el.removeAttribute(a); else el.setAttribute(a, v);
        return;
      }
      switch (k) {
        case 'grow': if (input.checked) { const h = el.getAttribute('h'); el.removeAttribute('h'); el.setAttribute('minH', h || '6mm'); } else { el.setAttribute('h', el.getAttribute('minH') || '6mm'); el.removeAttribute('minH'); } break;
        case 'text': { const v0 = ensure(el, 'value'); let tx = kid(v0, 'text'); if (!tx) { [...v0.children].forEach(c => c.remove()); tx = ensure(v0, 'text'); } setTextOf(tx, v); break; }
        case 'edge': { const g = kid(kid(el, 'value'), null); ensure(g, 'edge').setAttribute('thickness', `${num}pt`); break; }
        case 'href': kid(kid(el, 'value'), 'image').setAttribute('href', v); break;
        case 'caption': setTextOf(ensure(el, 'caption', 'value', 'text'), v); break;
        case 'capPlace': { const c = ensure(el, 'caption'); if (v === 'left') c.removeAttribute('placement'); else c.setAttribute('placement', v); break; }
        case 'capReserve': { const c = ensure(el, 'caption'); if (v === '') c.removeAttribute('reserve'); else c.setAttribute('reserve', `${num}mm`); break; }
        case 'bcType': kid(kid(el, 'ui'), 'barcode').setAttribute('type', v); break;
        case 'multiLine': { const te = kid(kid(el, 'ui'), 'textEdit'); if (input.checked) te.setAttribute('multiLine', '1'); else te.removeAttribute('multiLine'); break; }
        case 'picture': { if (v) setTextOf(ensure(el, 'format', 'picture'), v); else kid(el, 'format')?.remove(); break; }
        case 'default': { const val = ensure(el, 'value'); let c = kid(val, null); if (!c) { const ut = tag(kid(kid(el, 'ui'), null)); c = ensure(val, ut === 'numericEdit' ? 'decimal' : ut === 'dateTimeEdit' ? 'date' : 'text'); } setTextOf(c, v); if (!v) val.remove(); break; }
        case 'readOnly': if (input.checked) el.setAttribute('access', 'readOnly'); else el.removeAttribute('access'); break;
        case 'match': { const b = ensure(el, 'bind'); if (v === 'once') { b.remove(); break; } b.setAttribute('match', v); if (v !== 'dataRef') b.removeAttribute('ref'); else if (!b.getAttribute('ref')) b.setAttribute('ref', `$.${el.getAttribute('name') || ''}`); break; }
        case 'ref': ensure(el, 'bind').setAttribute('ref', v); break;
        case 'layout': if (v === 'position') el.removeAttribute('layout'); else el.setAttribute('layout', v); break;
        case 'cols': el.setAttribute('columnWidths', String(v).split(/\s+/).filter(Boolean).map(x => `${Number(x)}mm`).join(' ')); break;
        case 'repeat': { if (input.checked) { const o = ensure(el, 'occur'); o.setAttribute('max', '-1'); if (!o.hasAttribute('min')) o.setAttribute('min', '0'); } else kid(el, 'occur')?.remove(); break; }
        case 'keep': { if (input.checked) ensure(el, 'keep').setAttribute('intact', 'contentArea'); else kid(el, 'keep')?.remove(); break; }
        case 'typeface': ensure(el, 'font').setAttribute('typeface', v); break;
        case 'size': ensure(el, 'font').setAttribute('size', `${num}pt`); break;
        case 'bold': { const fn = ensure(el, 'font'); if (input.checked) fn.setAttribute('weight', 'bold'); else fn.removeAttribute('weight'); break; }
        case 'italic': { const fn = ensure(el, 'font'); if (input.checked) fn.setAttribute('posture', 'italic'); else fn.removeAttribute('posture'); break; }
        case 'hAlign': { const p = ensure(el, 'para'); if (v === 'left') p.removeAttribute('hAlign'); else p.setAttribute('hAlign', v); break; }
        case 'color': ensure(el, 'font', 'fill', 'color').setAttribute('value', hexRgb(v)); break;
        case 'border': { kid(el, 'border')?.remove(); if (input.checked) { const b = fromXml('<border><edge thickness="0.5pt"/></border>'); el.insertBefore(b, kid(el, 'ui')?.nextSibling || el.firstChild); } break; }
        case 'scriptLang': { const sc = scriptOf(el, X.scriptEv); if (!sc) return false; if (v === 'js') sc.setAttribute('contentType', 'application/x-javascript'); else sc.removeAttribute('contentType'); break; }
        case 'script': return setScript(el, X.scriptEv, v, $('.fd-props [data-k="scriptLang"]')?.value);
        case 'vmsg': { if (v) setTextOf(ensure(el, 'validate', 'message', 'text'), v); else kid(kid(el, 'validate'), 'message')?.remove(); break; }
        default: return false;
      }
    }, input?.type === 'checkbox' || input?.tagName === 'SELECT' ? '' : key);
    if (['layout', 'match', 'repeat', 'grow'].includes(k)) drawProps();
  }
  function setFormProp(k, v) {
    const m = /^pa:(\d+):(\w+)$/.exec(k);
    const pa = pageAreas()[m ? Number(m[1]) : 0];
    const pk = m ? m[2] : k;
    const root = bodyRoot();
    commit(() => {
      if (pk === 'paper' && PAGE_SIZES[v]) { const mg = marginsOf(pa); const md = ensure(pa, 'medium'); md.setAttribute('stock', v); md.setAttribute('short', `${PAGE_SIZES[v][0]}mm`); md.setAttribute('long', `${PAGE_SIZES[v][1]}mm`); setMargins(pa, mg); }
      else if (pk === 'orient') { const mg = marginsOf(pa); const md = ensure(pa, 'medium'); if (v === 'landscape') md.setAttribute('orientation', 'landscape'); else md.removeAttribute('orientation'); setMargins(pa, mg); }
      else if (pk === 'name') { if (!v) return false; pa.setAttribute('name', v); }
      else if (/^m[ltrb]$/.test(pk)) { if (v === '' || Number.isNaN(Number(v))) return false; const mg = marginsOf(pa); mg[pk[1]] = Number(v) * 72 / 25.4; setMargins(pa, mg); }
      else if (pk === 'occur') { if (v === 'once') ensure(pa, 'occur').setAttribute('max', '1'); else kid(pa, 'occur')?.remove(); }
      else if (k === 'rootLayout') { if (v === 'position') root.removeAttribute('layout'); else root.setAttribute('layout', v); }
      else if (k === 'locale') { if (v) root.setAttribute('locale', v); else root.removeAttribute('locale'); }
      else return false;
    }, k === 'locale' || /^pa:\d+:(name|m[ltrb])$/.test(k) ? `form|${k}` : '');
    if (/^pa:\d+:(paper|orient)$/.test(k)) drawProps();
  }
  $('.fd-props').addEventListener('click', e => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    if (b.dataset.act === 'toRich') return toRich(b.dataset.rt);
    if (b.dataset.act === 'addPage') return addMasterPage();
    tableAction(b.dataset.act);
  });
  $('.fd-props').addEventListener('input', e => { if (e.target.closest('.xd-rt')) return; const k = e.target.dataset.k; if (k && e.target.type !== 'checkbox' && e.target.tagName !== 'SELECT' && e.target.type !== 'color') setProp(k, e.target.value, e.target); });
  $('.fd-props').addEventListener('change', e => { if (e.target.closest('.xd-rt')) return; const k = e.target.dataset.k; if (k && (e.target.type === 'checkbox' || e.target.tagName === 'SELECT' || e.target.type === 'color')) setProp(k, e.target.value, e.target); });

  // ---------------------------------------------------------------- commands
  function command(a) {
    if (a === 'undo') return undoRedo(X.undo, X.redo);
    if (a === 'redo') return undoRedo(X.redo, X.undo);
    if (a === 'zin' || a === 'zout') { X.zoom = Math.max(0.4, Math.min(4, zoom() * (a === 'zin' ? 1.2 : 1 / 1.2))); return drawPages(); }
    if (a === 'fit') { X.zoom = 0; return drawPages(); }
    if (a === 'xdp' || a === 'xsd') {
      const link = document.createElement('a');
      if (a === 'xdp') { link.href = URL.createObjectURL(new Blob([getText()], { type: 'application/xml' })); link.download = `${String(name).toUpperCase()}.xdp`; }
      else if (X.itf) { link.href = `/a/${app}/api/forms/schema?interface=${encodeURIComponent(X.itf)}`; link.download = `${String(X.itf).toUpperCase()}.xsd`; }
      else { if (!X.fdp) return toast?.('The form has no data provider or interface'); link.href = `/a/${app}/api/forms/schema?srvd=${encodeURIComponent(X.fdp)}`; link.download = `${String(X.fdp).toUpperCase()}.xsd`; }
      document.body.appendChild(link); link.click(); link.remove();
      return;
    }
    if (['al', 'ar', 'ach', 'at', 'ab', 'acv', 'dh', 'dv', 'sw', 'sh'].includes(a)) return alignCmd(a);
    if (a === 'del' && X.multi.size > 1) {
      const els = [...X.multi].map(nodeAt).filter(e => e && e !== bodyRoot() && !['pageSet', 'contentArea'].includes(tag(e)));
      commit(() => { for (const e of els) if (e.parentElement) remove(e); });
      return select(null);
    }
    const el = nodeAt(X.sel);
    if (!el || el === bodyRoot() || ['pageSet', 'contentArea'].includes(tag(el))) return;
    const parent = el.parentElement;
    const sibs = kids(parent).filter(k => CONTENT.has(tag(k)));
    const i = sibs.indexOf(el);
    if (a === 'del') { const next = sibs[i + 1] || sibs[i - 1]; commit(() => remove(el)); return select(next ? pathOf(next) : pathOf(parent)); }
    if (a === 'dup') {
      let c;
      commit(() => {
        c = el.cloneNode(true);
        [c, ...c.getElementsByTagNameNS('*', '*')].forEach(n => { if (n.getAttribute('name') && ['field', 'draw', 'subform', 'exclGroup'].includes(tag(n))) n.setAttribute('name', uniqueName(n.getAttribute('name').replace(/\d+$/, ''))); n.removeAttribute('id'); });
        if (positioned(containerOf(el) || X.tpl)) { c.setAttribute('x', mm(toPt(el.getAttribute('x')) + 14)); c.setAttribute('y', mm(toPt(el.getAttribute('y')) + 14)); }
        place(parent, c, el.nextElementSibling);
      });
      return c && select(pathOf(c));
    }
    if (a === 'up' && i > 0) { commit(() => { remove(el); place(parent, el, sibs[i - 1]); }); return select(pathOf(el)); }
    if (a === 'down' && i >= 0 && i < sibs.length - 1) { commit(() => { remove(el); place(parent, el, sibs[i + 1].nextElementSibling); }); return select(pathOf(el)); }
  }
  $('.fd-tools').addEventListener('click', e => { const b = e.target.closest('[data-a]'); if (b) command(b.dataset.a); });
  $('.xd-outl').onchange = e => { X.outlines = e.target.checked; canvas.querySelectorAll('.fd-ov').forEach(o => o.classList.toggle('xd-outl', X.outlines)); };
  const onKey = e => {
    if (!host.isConnected || host.closest('[hidden]')) return;
    if (e.target.closest?.('input, textarea, select, [contenteditable="true"]') || !host.contains(document.activeElement)) return;
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === 'c') { e.preventDefault(); return copySel(); }
    if (mod && e.key.toLowerCase() === 'v') { e.preventDefault(); return pasteClip(); }
    if (mod && e.key.toLowerCase() === 'x') { e.preventDefault(); copySel(); return command('del'); }
    if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); return command(e.shiftKey ? 'redo' : 'undo'); }
    if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); return command('redo'); }
    if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); return command('dup'); }
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); return command('del'); }
    if (e.key === 'Escape') { const el = nodeAt(X.sel); const c = el && containerOf(el); return select(c && c !== bodyRoot() ? pathOf(c) : null); }
    const el = nodeAt(X.sel);
    if (X.multi.size > 1 && e.key.startsWith('Arrow') && !e.altKey) {
      e.preventDefault();
      const s = (e.shiftKey ? 5 : 0.5) * 72 / 25.4, dx = e.key === 'ArrowLeft' ? -s : e.key === 'ArrowRight' ? s : 0, dy = e.key === 'ArrowUp' ? -s : e.key === 'ArrowDown' ? s : 0;
      const keep = [...X.multi];
      commit(() => { for (const x of keep.map(nodeAt)) if (x && containerOf(x) && positioned(containerOf(x))) { x.setAttribute('x', mm(Math.max(0, toPt(x.getAttribute('x')) + dx))); x.setAttribute('y', mm(Math.max(0, toPt(x.getAttribute('y')) + dy))); } }, `nudge|${keep.join(',')}`);
      X.multi = new Set(keep); markSel();
      return;
    }
    if (el && e.key.startsWith('Arrow')) {
      e.preventDefault();
      const cont = containerOf(el);
      if (e.altKey || !cont || !positioned(cont)) return command(e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? 'up' : 'down');
      const s = (e.shiftKey ? 5 : 0.5) * 72 / 25.4, dx = e.key === 'ArrowLeft' ? -s : e.key === 'ArrowRight' ? s : 0, dy = e.key === 'ArrowUp' ? -s : e.key === 'ArrowDown' ? s : 0;
      commit(() => { el.setAttribute('x', mm(Math.max(0, toPt(el.getAttribute('x')) + dx))); el.setAttribute('y', mm(Math.max(0, toPt(el.getAttribute('y')) + dy))); }, `nudge|${X.sel}`);
    }
  };
  document.addEventListener('keydown', onKey);
  const ro = new ResizeObserver(() => { if (!X.zoom && X.layout) drawPages(); });
  ro.observe(canvas);

  api('GET', `/a/${app}/api/forms/records?name=${encodeURIComponent(name)}`).then(r => {
    if (!r.records?.length) return;
    $('.fd-rec').insertAdjacentHTML('beforeend', `<optgroup label="${esc(r.entity)}">${r.records.map(x => `<option value='${esc(JSON.stringify(x.keys))}'>${esc(x.text)}</option>`).join('')}</optgroup>`);
  }).catch(() => {});
  $('.fd-rec').onchange = e => { X.keys = e.target.value ? JSON.parse(e.target.value) : null; relayout(true); };

  X.lastText = getText(); parse();
  drawTree(); drawProps(); relayout(true);
  return {
    // the source changed outside the designer (Source view, the chat agent)
    refresh() { const t = getText(); if (t === X.lastText) return; X.lastText = t; parse(); if (X.sel && !nodeAt(X.sel)) X.sel = null; X.multi = new Set([...X.multi].filter(p => nodeAt(p))); if (X.sel) X.multi.add(X.sel); drawTree(); drawProps(); relayout(); },
    destroy() { document.removeEventListener('keydown', onKey); ro.disconnect(); clearTimeout(timer); renderTasks.forEach(t => t.cancel?.()); },
  };
}
