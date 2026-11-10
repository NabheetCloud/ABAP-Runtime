// Visual form designer for print form layouts (src/<name>.form.json), in the manner of Adobe LiveCycle Designer:
// the page as it prints (laid out by the form engine on the server), an object library to drag objects from, the
// hierarchy of the layout, a data view (the data provider's fields: drag them onto the page to bind them) and the
// properties of the selected object. Every change is written back to the layout's JSON (the file stays the source;
// the Source view shows it), with undo and redo.
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clone = v => JSON.parse(JSON.stringify(v));
const segs = p => String(p).split('.').map(x => (/^\d+$/.test(x) ? Number(x) : x));
const getAt = (o, p) => { for (const k of segs(p)) o = o?.[k]; return o; };
const parentOf = p => { const s = String(p).split('.'); const i = Number(s.pop()); return [s.join('.'), i]; };
const depth = p => String(p).split('.').length;
const round = n => Math.round(n * 10) / 10;

// the compact JSON style of the layouts: short objects and arrays on one line
const inline = v => (Array.isArray(v) ? `[${v.map(inline).join(', ')}]` : v && typeof v === 'object' ? (Object.keys(v).length ? `{ ${Object.entries(v).map(([k, x]) => `${JSON.stringify(k)}: ${inline(x)}`).join(', ')} }` : '{}') : JSON.stringify(v) ?? 'null');
export function formatLayout(v, ind = '') {
  const one = inline(v);
  if (one.length + ind.length <= 116 || v === null || typeof v !== 'object') return one;
  const inner = `${ind}  `;
  if (Array.isArray(v)) return `[\n${v.map(x => inner + formatLayout(x, inner)).join(',\n')}\n${ind}]`;
  return `{\n${Object.entries(v).map(([k, x]) => `${inner}${JSON.stringify(k)}: ${formatLayout(x, inner)}`).join(',\n')}\n${ind}}`;
}

// the object library (the palette): what a drop creates
const LIBRARY = [
  ['Standard', [
    ['text', 'Text', 'T', () => ({ text: 'Text' })],
    ['fields', 'Text field', '▭', () => ({ fields: [['Label', '{field}']] })],
    ['table', 'Table', '▦', () => ({ table: 'items', columns: [{ title: 'Item', field: 'item' }, { title: 'Description', field: 'description' }, { title: 'Amount', field: 'amount', format: 'amount', align: 'right' }] })],
    ['repeat', 'Repeating subform', '⟳', () => ({ repeat: 'items', items: [{ text: '{description}' }] })],
    ['columns', 'Columns', '▥', () => ({ columns: [{ width: 1, items: [] }, { width: 1, items: [] }], gap: 12 })],
    ['box', 'Positioned subform', '▢', () => ({ box: [{ text: 'Text' }], width: 200, border: '#94a3b8', padding: 6 })],
    ['image', 'Image', '🖼', () => ({ image: 'logo.png', width: 120 })],
    ['textModule', 'Text module', '¶', () => ({ textModule: 'terms' })],
    ['line', 'Line', '—', () => ({ line: true })],
    ['space', 'Space', '↕', () => ({ space: 12 })],
    ['pagebreak', 'Page break', '⤓', () => ({ pagebreak: true })],
  ]],
  ['Barcodes', [
    ['qr', 'QR code', '▩', () => ({ barcode: 'qr', value: '{id}', size: 70 })],
    ['datamatrix', 'Data Matrix', '▩', () => ({ barcode: 'datamatrix', value: '{id}', size: 50 })],
    ['pdf417', 'PDF417', '▤', () => ({ barcode: 'pdf417', value: '{id}', width: 180, height: 50 })],
    ['code128', 'Code 128', '║', () => ({ barcode: 'code128', value: '{id}', width: 160, height: 36 })],
    ['code39', 'Code 39', '║', () => ({ barcode: 'code39', value: '{id}', width: 180, height: 36 })],
    ['ean13', 'EAN-13', '║', () => ({ barcode: 'ean13', value: '400638133393', width: 130, height: 50 })],
    ['aztec', 'Aztec', '▩', () => ({ barcode: 'aztec', value: '{id}', size: 50 })],
    ['gs1-128', 'GS1-128', '║', () => ({ barcode: 'gs1-128', value: '(01)09521234543213', width: 200, height: 40 })],
  ]],
  ['Interactive (fillable)', [
    ['input-text', 'Text field', '⌨', () => ({ input: 'field1', label: 'Label', type: 'text', width: 220 })],
    ['input-multiline', 'Multi-line field', '☰', () => ({ input: 'remark', label: 'Remark', type: 'multiline', height: 60 })],
    ['input-checkbox', 'Check box', '☑', () => ({ input: 'confirmed', label: 'Confirmed', type: 'checkbox' })],
    ['input-dropdown', 'Drop-down list', '▾', () => ({ input: 'choice', label: 'Choice', type: 'dropdown', options: ['A', 'B'] })],
    ['input-signature', 'Signature field', '✍', () => ({ input: 'signature', label: 'Signature', type: 'signature', width: 220, height: 50 })],
  ]],
];
const KINDS = ['text', 'textModule', 'fields', 'table', 'repeat', 'image', 'barcode', 'columns', 'box', 'input', 'line', 'space', 'pagebreak'];
const kindOf = it => KINDS.find(k => it && it[k] !== undefined) || 'item';
const ICON = { text: 'T', textModule: '¶', fields: '▭', table: '▦', repeat: '⟳', image: '🖼', barcode: '▩', columns: '▥', box: '▢', input: '⌨', line: '—', space: '↕', pagebreak: '⤓', column: '▯' };
const NAME = { text: 'Text', textModule: 'Text module', fields: 'Text field', table: 'Table', repeat: 'Repeating subform', image: 'Image', barcode: 'Barcode', columns: 'Columns', box: 'Positioned subform', input: 'Fillable field', line: 'Line', space: 'Space', pagebreak: 'Page break' };
const summary = it => {
  const k = kindOf(it);
  const s = k === 'text' ? it.text : k === 'fields' ? (it.fields || []).map(f => f[0]).join(', ') : k === 'table' || k === 'repeat' ? it[k] : k === 'image' ? it.image : k === 'barcode' ? `${it.barcode} ${it.value || ''}` : k === 'input' ? `${it.type || 'text'} ${it.input}` : k === 'textModule' ? it.textModule : k === 'space' ? `${it.space}` : '';
  return String(s || '').replace(/\s+/g, ' ').slice(0, 48);
};
// the lists of a layout that hold items, and of an item
const ROOTS = [['header', 'Master page · header'], ['firstHeader', 'Master page · first page header'], ['content', 'Body'], ['footer', 'Master page · footer']];
const childLists = (it, p) => {
  const k = kindOf(it);
  if (k === 'box') return [[`${p}.box`, null]];
  if (k === 'repeat') return [[`${p}.items`, null]];
  if (k === 'columns') return (it.columns || []).map((c, i) => [`${p}.columns.${i}.items`, `Column ${i + 1} (width ${c.width ?? 1})`]);
  return [];
};

export function mountDesigner(host, { getText, setText, app, name, api, toast }) {
  const D = { form: null, sel: null, layout: null, data: {}, undo: [], redo: [], zoom: 0, page: 0, keys: null, assets: [], lastEdit: 0, editKey: '' };
  host.innerHTML = `<div class="fd">
    <div class="fd-left"><section class="fd-sec fd-grow"><h4>Hierarchy</h4><div class="fd-tree" tabindex="0"></div></section>
      <section class="fd-sec fd-grow"><h4>Data View <small class="fd-src"></small></h4><div class="fd-data"></div></section></div>
    <div class="fd-mid"><div class="fd-tools">
        <button class="btn sm" data-a="undo" title="Undo (Ctrl+Z)">↶</button><button class="btn sm" data-a="redo" title="Redo (Ctrl+Shift+Z)">↷</button>
        <span class="fd-sep"></span><button class="btn sm" data-a="up" title="Move up (Alt+↑)">↑</button><button class="btn sm" data-a="down" title="Move down (Alt+↓)">↓</button>
        <button class="btn sm" data-a="dup" title="Duplicate (Ctrl+D)">⧉</button><button class="btn sm" data-a="del" title="Delete (Del)">🗑</button>
        <span class="fd-sep"></span><button class="btn sm" data-a="zout" title="Zoom out">−</button><span class="fd-zoom"></span><button class="btn sm" data-a="zin" title="Zoom in">+</button><button class="btn sm" data-a="fit" title="Fit the page width">Fit</button>
        <span class="spacer"></span><select class="fd-rec" title="Data shown on the page"><option value="">Sample data</option></select><span class="fd-info"></span></div>
      <div class="fd-warn" hidden></div><div class="fd-canvas" tabindex="0"></div></div>
    <div class="fd-right"><section class="fd-sec"><h4>Object Library</h4><div class="fd-lib"></div></section>
      <section class="fd-sec fd-grow"><h4 class="fd-ptitle">Object</h4><div class="fd-props"></div></section></div>
  </div>`;
  const $ = s => host.querySelector(s);
  const canvas = $('.fd-canvas');

  // ---------------------------------------------------------------- model: parse, change, undo
  const parse = () => { try { D.form = JSON.parse(getText()); D.error = null; } catch (e) { D.error = e.message; } };
  function commit(mutate, key, keepProps) {
    const before = getText();
    const f = clone(D.form);
    const r = mutate(f);
    if (r === false) return;
    const text = `${formatLayout(f)}\n`;
    if (text === before) return;
    // typing in one property: one undo step
    if (!(key && key === D.editKey && Date.now() - D.lastEdit < 1500)) { D.undo.push(before); if (D.undo.length > 200) D.undo.shift(); }
    D.editKey = key || ''; D.lastEdit = Date.now();
    D.redo = [];
    D.form = f;
    D.lastText = text;
    setText(text);
    if (keepProps) { D.selItem = D.sel ? getAt(D.form, D.sel) : null; drawTree(); relayout(); } else refreshAll();
  }
  function undoRedo(from, to) {
    if (!from.length) return;
    to.push(getText());
    const t = from.pop();
    D.lastText = t; setText(t); D.editKey = ''; parse();
    if (D.sel && getAt(D.form, D.sel) === undefined) D.sel = null;
    refreshAll();
  }
  const listAt = (f, lp, create) => { const s = segs(lp); const key = s.pop(); let o = f; for (const k of s) o = o?.[k]; if (!o) return null; if (!Array.isArray(o[key]) && create) o[key] = []; return o[key]; };
  function insert(f, lp, index, obj) { const l = listAt(f, lp, true); l.splice(Math.max(0, Math.min(index, l.length)), 0, obj); return `${lp}.${Math.max(0, Math.min(index, l.length - 1))}`; }
  function removeAt(f, p) { const [lp, i] = parentOf(p); const l = listAt(f, lp); const [it] = l.splice(i, 1); if (!l.length && /^(header|footer|firstHeader)$/.test(lp)) delete f[lp]; return it; }
  // move an item to a list position (adjusting the index when it moves down in the same list)
  function moveTo(p, lp, index) {
    if (lp === p || lp.startsWith(`${p}.`)) return;
    let newPath;
    commit(f => {
      const [from, i] = parentOf(p);
      const it = removeAt(f, p);
      if (from === lp && i < index) index--;
      // a list path below the moved item's old position in the same parent list shifts by one
      let target = lp;
      const fs = `${from}.`;
      if (target.startsWith(fs)) { const rest = target.slice(fs.length).split('.'); if (Number(rest[0]) > i) { rest[0] = String(Number(rest[0]) - 1); target = fs + rest.join('.'); } }
      newPath = insert(f, target, index, it);
    });
    if (newPath) select(newPath);
  }

  // ---------------------------------------------------------------- server layout
  let seq = 0, timer = null;
  function relayout(soon) {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      if (D.error) { showWarn([`The layout is not valid JSON: ${D.error} (fix it in the Source view)`], true); return; }
      const my = ++seq;
      const r = await api('POST', `/a/${app}/api/forms/design`, { name, text: getText(), keys: D.keys || undefined }).catch(e => ({ error: e.message }));
      if (my !== seq) return;
      if (r.error) { showWarn([r.error.message || r.error], true); return; }
      D.layout = r.layout; D.data = r.data || {}; D.assets = r.assets || []; D.pages = r.pages;
      $('.fd-src').textContent = r.source === 'record' ? '(record)' : '(sample)';
      $('.fd-info').textContent = `${r.pages} page${r.pages === 1 ? '' : 's'}${r.fields?.length ? ` · ${r.fields.length} fillable` : ''}`;
      showWarn(r.warnings || []);
      drawPages(); drawData();
    }, soon ? 0 : 250);
  }
  function showWarn(list, bad) { const w = $('.fd-warn'); w.hidden = !list.length; w.classList.toggle('bad', !!bad); w.textContent = list.length ? `${bad ? '' : `${list.length} warning${list.length > 1 ? 's' : ''}: `}${list.slice(0, 4).join(' · ')}` : ''; }

  // ---------------------------------------------------------------- the pages
  const col = c => (Array.isArray(c) ? `rgb(${c.join(',')})` : '#000');
  const FAM = { sans: 'Helvetica, Arial, sans-serif', serif: '"Times New Roman", Times, serif', mono: 'Courier, "Courier New", monospace' };
  function svgOf(ops, W, H) {
    const out = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="100%" height="100%"><rect width="${W}" height="${H}" fill="#fff"/>`];
    for (const o of ops) {
      if (o.op === 'text') out.push(`<text x="${o.x}" y="${o.y}" font-size="${o.size}" font-family='${FAM[o.family] || FAM.sans}'${o.bold ? ' font-weight="bold"' : ''}${o.italic ? ' font-style="italic"' : ''} fill="${col(o.color)}"${o.w && !o.angle ? ` textLength="${o.w}" lengthAdjust="spacingAndGlyphs"` : ''}${o.angle ? ` transform="rotate(${-o.angle} ${o.x} ${o.y})"` : ''}${o.opacity ? ` opacity="${o.opacity}"` : ''} xml:space="preserve">${esc(o.text)}</text>`);
      else if (o.op === 'line') out.push(`<line x1="${o.x1}" y1="${o.y1}" x2="${o.x2}" y2="${o.y2}" stroke="${col(o.color)}" stroke-width="0.6"/>`);
      else if (o.op === 'rect') out.push(`<rect x="${o.x}" y="${o.y}" width="${o.w}" height="${o.h}" fill="${o.fill ? col(o.fill) : 'none'}" stroke="${o.stroke ? col(o.stroke) : 'none'}" stroke-width="0.6"/>`);
      else if (o.op === 'image') out.push(o.src ? `<image href="${o.src}" x="${o.x}" y="${o.y}" width="${o.w}" height="${o.h}" preserveAspectRatio="none"/>` : `<rect x="${o.x}" y="${o.y}" width="${o.w}" height="${o.h}" fill="#e2e8f0"/>`);
      else if (o.op === 'bars') out.push(`<path d="${o.bars.map(b => `M${o.x + b.x * o.mod} ${o.y}h${b.w * o.mod}v${o.h}h${-b.w * o.mod}z`).join('')}"/>`);
      else if (o.op === 'qr' || o.op === 'matrix') out.push(`<path d="${o.dark.map(([cx, cy]) => `M${o.x + cx * (o.mx || o.m)} ${o.y + cy * (o.my || o.m)}h${(o.mx || o.m) + 0.05}v${(o.my || o.m) + 0.05}h${-((o.mx || o.m) + 0.05)}z`).join('')}"/>`);
      else if (o.op === 'field') {
        out.push(`<rect x="${o.x}" y="${o.y}" width="${o.w}" height="${o.h}" fill="#eef4ff" stroke="#94a3b8" stroke-width="0.6"/>`);
        if (o.type === 'checkbox' && o.value) out.push(`<text x="${o.x + 2}" y="${o.y + o.h - 2}" font-size="${o.h * 0.9}" font-family="${FAM.sans}">✓</text>`);
        else if (o.type === 'signature') out.push(`<text x="${o.x + 4}" y="${o.y + o.h - 6}" font-size="8" fill="#94a3b8" font-family="${FAM.sans}">signature</text>`);
        else if (o.value) out.push(`<text x="${o.x + 3}" y="${o.y + Math.min(o.h - 4, 12)}" font-size="${o.size || 10}" font-family="${FAM.sans}">${esc(String(o.value).split('\n')[0])}</text>`);
      }
    }
    out.push('</svg>');
    return out.join('');
  }
  const zoom = () => D.zoom || Math.max(0.4, Math.min(2, (canvas.clientWidth - 48) / (D.layout?.width || 595)));
  function drawPages() {
    const L = D.layout;
    if (!L) return;
    const z = zoom();
    $('.fd-zoom').textContent = `${Math.round(z * 100)}%`;
    const scroll = canvas.scrollTop;
    canvas.innerHTML = L.pages.map((ops, pi) => `<div class="fd-page" data-page="${pi}" style="width:${L.width * z}px;height:${L.height * z}px">
      ${svgOf(ops, L.width, L.height)}
      <div class="fd-ov" style="transform:scale(${z});width:${L.width}px;height:${L.height}px;--hs:${10 / z}px;--bw:${1 / z}px">
        <div class="fd-zone" style="top:${L.headerTop}px;height:${Math.max(0, L.top - L.headerTop)}px;left:${L.margin.left}px;right:${L.margin.right}px"><span>Header</span></div>
        <div class="fd-zone body" style="top:${L.top}px;height:${Math.max(0, L.footerTop - L.top)}px;left:${L.margin.left}px;right:${L.margin.right}px"><span>Body · page ${pi + 1}</span></div>
        <div class="fd-zone" style="top:${L.footerTop}px;height:${Math.max(0, L.height - L.margin.bottom - L.footerTop)}px;left:${L.margin.left}px;right:${L.margin.right}px"><span>Footer</span></div>
        ${L.boxes.filter(b => b.page === pi).sort((a, b) => depth(a.path) - depth(b.path)).map(b => `<div class="fd-box k-${b.kind}${b.positioned ? ' pos' : ''}${b.hidden ? ' hid' : ''}${b.path === D.sel ? ' sel' : ''}" data-path="${b.path}" title="${esc(NAME[b.kind] || (b.kind === 'column' ? 'Column' : b.kind))}${b.hidden ? ' (hidden by its condition)' : ''}" style="left:${b.x}px;top:${b.y}px;width:${b.w}px;height:${Math.max(b.h, 3)}px"></div>`).join('')}
      </div></div>`).join('') + (L.pages.length ? '' : '<div class="fd-empty">Empty page</div>');
    canvas.scrollTop = scroll;
    markSel();
  }
  function markSel() {
    canvas.querySelectorAll('.fd-box').forEach(b => { b.classList.toggle('sel', b.dataset.path === D.sel); b.querySelectorAll('.fd-h').forEach(h => h.remove()); });
    const it = D.sel && getAt(D.form, D.sel);
    if (!it) return;
    const k = kindOf(it);
    canvas.querySelectorAll(`.fd-box[data-path="${D.sel}"]`).forEach(b => {
      if (['box', 'image', 'barcode', 'input', 'space'].includes(k)) b.insertAdjacentHTML('beforeend', '<span class="fd-h se" data-h="se"></span>');
    });
    // column borders of a columns item: drag to change the widths
    if (k === 'columns') canvas.querySelectorAll(`.fd-box[data-path^="${D.sel}.columns."].k-column`).forEach((b, i, all) => { if (i < all.length - 1) b.insertAdjacentHTML('beforeend', `<span class="fd-h col" data-h="col" data-c="${i}"></span>`); });
  }

  // ---------------------------------------------------------------- hierarchy
  function drawTree() {
    const f = D.form || {};
    const row = (it, p, lvl) => {
      const k = kindOf(it);
      const kids = childLists(it, p);
      return `<div class="fd-row${p === D.sel ? ' sel' : ''}${it.if ? ' cond' : ''}" data-path="${p}" draggable="true" style="padding-left:${8 + lvl * 14}px" title="${esc(it.if ? `Condition: ${it.if}` : '')}"><span class="ic">${ICON[k] || '·'}</span><b>${esc(NAME[k] || k)}</b><span class="sm">${esc(summary(it))}</span>${it.if ? '<span class="tag">if</span>' : ''}</div>`
        + kids.map(([lp, label]) => (label ? `<div class="fd-row grp" data-list="${lp}" style="padding-left:${22 + lvl * 14}px"><span class="ic">${ICON.column}</span>${esc(label)}</div>` : '')
          + (listAt(f, lp) || []).map((c, j) => row(c, `${lp}.${j}`, lvl + (label ? 2 : 1))).join('')).join('');
    };
    $('.fd-tree').innerHTML = `<div class="fd-row root${D.sel ? '' : ' sel'}" data-path=""><span class="ic">📄</span><b>${esc(f.title || name)}</b><span class="sm">form properties</span></div>`
      + ROOTS.filter(([k]) => k !== 'firstHeader' || f.firstHeader).map(([k, label]) => `<div class="fd-row grp" data-list="${k}"><span class="ic">${k === 'content' ? '▤' : '▭'}</span>${label}</div>${(f[k] || []).map((it, j) => row(it, `${k}.${j}`, 1)).join('')}`).join('');
    const sel = $('.fd-tree .fd-row.sel');
    if (sel && D.scrollTree) { sel.scrollIntoView({ block: 'nearest' }); D.scrollTree = false; }
  }
  $('.fd-tree').addEventListener('click', e => { const r = e.target.closest('.fd-row'); if (r && r.dataset.path !== undefined) select(r.dataset.path || null); });
  // drag in the hierarchy: before / after a row, into a group (a list)
  $('.fd-tree').addEventListener('dragstart', e => { const r = e.target.closest('.fd-row[data-path]'); if (!r || !r.dataset.path) return e.preventDefault(); e.dataTransfer.setData('text/x-path', r.dataset.path); e.dataTransfer.effectAllowed = 'move'; D.treeDrag = r.dataset.path; });
  $('.fd-tree').addEventListener('dragover', e => {
    const r = e.target.closest('.fd-row'); if (!r || !D.treeDrag) return;
    e.preventDefault();
    $('.fd-tree').querySelectorAll('.drop-b,.drop-a,.drop-in').forEach(x => x.classList.remove('drop-b', 'drop-a', 'drop-in'));
    const rc = r.getBoundingClientRect();
    if (r.dataset.list) r.classList.add('drop-in'); else if (r.dataset.path) r.classList.add(e.clientY < rc.top + rc.height / 2 ? 'drop-b' : 'drop-a');
  });
  $('.fd-tree').addEventListener('dragend', () => { D.treeDrag = null; $('.fd-tree').querySelectorAll('.drop-b,.drop-a,.drop-in').forEach(x => x.classList.remove('drop-b', 'drop-a', 'drop-in')); });
  $('.fd-tree').addEventListener('drop', e => {
    e.preventDefault();
    const r = e.target.closest('.fd-row'), p = D.treeDrag; D.treeDrag = null;
    if (!r || !p) return;
    if (r.dataset.list) return moveTo(p, r.dataset.list, 0);
    if (!r.dataset.path || r.dataset.path === p) return;
    const [lp, i] = parentOf(r.dataset.path);
    moveTo(p, lp, r.classList.contains('drop-a') ? i + 1 : i);
  });

  // ---------------------------------------------------------------- data view: drag fields and tables onto the page
  function drawData() {
    const rows = [];
    const walk = (v, p, lvl, label) => {
      if (Array.isArray(v)) {
        rows.push(`<div class="fd-d tbl" data-d="${esc(p)}" data-t="table" style="padding-left:${6 + lvl * 12}px"><span class="ic">▦</span>${esc(label)} <small>table</small></div>`);
        const first = v[0];
        if (first && typeof first === 'object') for (const [k, x] of Object.entries(first)) walk(x, `${p}.${k}`, lvl + 1, k);
      } else if (v && typeof v === 'object') {
        if (label) rows.push(`<div class="fd-d grp" style="padding-left:${6 + lvl * 12}px"><span class="ic">{}</span>${esc(label)}</div>`);
        for (const [k, x] of Object.entries(v)) if (k !== 'sy') walk(x, p ? `${p}.${k}` : k, lvl + (label ? 1 : 0), k);
      } else rows.push(`<div class="fd-d" data-d="${esc(p)}" data-t="field" data-v="${esc(String(v ?? '').slice(0, 40))}" style="padding-left:${6 + lvl * 12}px" title="${esc(`{${p}}: ${String(v ?? '')}`)}"><span class="ic">•</span>${esc(label)}<small>${esc(String(v ?? '').slice(0, 18))}</small></div>`);
    };
    walk(D.data, '', 0, '');
    const vars = Object.keys(D.form?.variables || {});
    $('.fd-data').innerHTML = (rows.join('') || '<p class="fd-note">No data: give the form a data provider or sample data (form properties).</p>')
      + (vars.length ? `<div class="fd-d grp"><span class="ic">ƒ</span>Variables</div>${vars.map(v => `<div class="fd-d" data-d="${esc(v)}" data-t="field" style="padding-left:18px"><span class="ic">ƒ</span>${esc(v)}</div>`).join('')}` : '');
  }
  const pretty = k => String(k).replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());
  const fmtHint = v => (/^\d{8}$/.test(v) ? 'date' : /^-?\d+\.\d+$/.test(v) ? 'amount' : '');
  // an item for a data field or table dropped into a list (relative to the table of a repeating subform it lands in)
  function dataItem(d, lp) {
    let p = d.path;
    for (const [, t] of containersOf(lp)) if (t && p.startsWith(`${t}.`)) p = p.slice(t.length + 1);
    if (d.type === 'table') {
      const first = getAt(D.data, d.path)?.[0] || {};
      const cols = Object.entries(first).filter(([, v]) => v === null || typeof v !== 'object').slice(0, 6).map(([k, v]) => ({ title: pretty(k), field: k, ...(fmtHint(String(v)) ? { format: fmtHint(String(v)) } : {}), ...(typeof v === 'number' || /^-?\d+(\.\d+)?$/.test(String(v)) ? { align: 'right' } : {}) }));
      return { table: p, columns: cols.length ? cols : [{ title: 'Value', field: 'value' }] };
    }
    const h = fmtHint(d.value || '');
    return { fields: [[pretty(p.split('.').pop()), `{${p}${h ? `:${h}` : ''}}`]] };
  }
  // the tables of the repeating subforms and tables around a list path
  function containersOf(lp) {
    const out = [];
    const s = String(lp).split('.');
    for (let k = 1; k < s.length; k++) { const it = getAt(D.form, s.slice(0, k).join('.')); if (it && typeof it === 'object' && !Array.isArray(it) && it.repeat) out.push([s.slice(0, k).join('.'), it.repeat]); }
    return out;
  }

  // ---------------------------------------------------------------- object library
  $('.fd-lib').innerHTML = LIBRARY.map(([g, items]) => `<div class="fd-lg">${g}</div><div class="fd-tiles">${items.map(([id, label, ic]) => `<div class="fd-tile" data-lib="${id}" title="Drag onto the page (or double-click to add at the end)"><span class="ic">${ic}</span>${label}</div>`).join('')}</div>`).join('');
  const libItem = id => LIBRARY.flatMap(([, l]) => l).find(x => x[0] === id)?.[3]();
  $('.fd-lib').addEventListener('dblclick', e => { const t = e.target.closest('.fd-tile'); if (!t) return; let np; commit(f => { np = insert(f, 'content', (f.content || []).length, libItem(t.dataset.lib)); }); if (np) select(np); });

  // ---------------------------------------------------------------- dragging: library, data view, objects on the page
  // where a drop at a point of a page goes: into a list at an index (a line shows it), or a new position (boxes)
  function dropTarget(pi, x, y, exclude) {
    const L = D.layout;
    const bs = L.boxes.filter(b => b.page === pi && !b.hidden && !(exclude && (b.path === exclude || b.path.startsWith(`${exclude}.`))));
    const inside = b => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + Math.max(b.h, 4);
    const hits = bs.filter(inside).sort((a, b) => depth(b.path) - depth(a.path) || a.w * a.h - b.w * b.h);
    const indexIn = (lp, b0) => { const kids = bs.filter(b => parentOf(b.path)[0] === lp && !b.cont); const after = kids.filter(b => b.y + b.h / 2 <= y); if (after.length) { const last = after.reduce((m, b) => (parentOf(b.path)[1] > parentOf(m.path)[1] ? b : m)); return { index: parentOf(last.path)[1] + 1, line: { x: b0.x, y: last.y + last.h, w: b0.w } }; } const firstK = kids.reduce((m, b) => (!m || parentOf(b.path)[1] < parentOf(m.path)[1] ? b : m), null); return { index: firstK ? parentOf(firstK.path)[1] : (listAt(D.form, lp) || []).length, line: { x: b0.x, y: firstK ? firstK.y : b0.y + 2, w: b0.w } }; };
    for (const h of hits) {
      const it = h.kind === 'column' ? null : getAt(D.form, h.path);
      if (h.kind === 'column') return { list: `${h.path}.items`, ...indexIn(`${h.path}.items`, h), into: h };
      const k = kindOf(it);
      if ((k === 'box' || k === 'repeat') && y > h.y + 5 && y < h.y + h.h - 5) { const lp = `${h.path}.${k === 'box' ? 'box' : 'items'}`; return { list: lp, ...indexIn(lp, h), into: h }; }
      if (k === 'columns') continue;   // between its columns: the item before / after the columns
      const [lp, i] = parentOf(h.path);
      const before = y < h.y + h.h / 2;
      return { list: lp, index: before ? i : i + 1, line: { x: h.x, y: before ? h.y : h.y + h.h, w: h.w } };
    }
    const zone = y < L.top ? (pi === 0 && D.form.firstHeader ? 'firstHeader' : 'header') : y >= L.footerTop ? 'footer' : 'content';
    const body = { x: L.margin.left, y: zone === 'content' ? L.top : zone === 'footer' ? L.footerTop : L.headerTop, w: L.width - L.margin.left - L.margin.right };
    return { list: zone, ...indexIn(zone, body), zone };
  }
  let drag = null;
  function startDrag(e, what) {
    drag = { ...what, x0: e.clientX, y0: e.clientY, on: false };
    const mv = ev => {
      if (!drag) return;
      if (!drag.on && Math.hypot(ev.clientX - drag.x0, ev.clientY - drag.y0) < 4) return;
      if (!drag.on) { drag.on = true; document.body.classList.add('fd-dragging'); if (drag.label) { drag.ghost = document.createElement('div'); drag.ghost.className = 'fd-ghost'; drag.ghost.textContent = drag.label; document.body.appendChild(drag.ghost); } }
      if (drag.ghost) { drag.ghost.style.left = `${ev.clientX + 12}px`; drag.ghost.style.top = `${ev.clientY + 8}px`; }
      over(ev);
    };
    const up = ev => { document.removeEventListener('pointermove', mv); document.removeEventListener('pointerup', up); const d = drag; drag = null; document.body.classList.remove('fd-dragging'); d.ghost?.remove(); clearMarks(); if (d.on) drop(d, ev); else d.click?.(); };
    document.addEventListener('pointermove', mv); document.addEventListener('pointerup', up);
  }
  const pageAt = ev => { const el = document.elementFromPoint(ev.clientX, ev.clientY)?.closest?.('.fd-page'); if (!el || !host.contains(el)) return null; const r = el.getBoundingClientRect(), z = zoom(); return { el, pi: Number(el.dataset.page), x: (ev.clientX - r.left) / z, y: (ev.clientY - r.top) / z }; };
  function clearMarks() { canvas.querySelectorAll('.fd-ins,.fd-into').forEach(x => x.remove()); }
  function over(ev) {
    clearMarks();
    const at = pageAt(ev);
    if (!at || !D.layout) return;
    const ov = at.el.querySelector('.fd-ov');
    if (drag.mode === 'resize') return resize(at);
    if (drag.positioned) {   // a positioned subform: where its corner goes
      if (drag.mode === 'move') { const b = canvas.querySelectorAll(`.fd-box[data-path="${drag.path}"]`)[0]; if (b) { b.style.left = `${at.x - drag.dx}px`; b.style.top = `${at.y - drag.dy}px`; } }
      else ov.insertAdjacentHTML('beforeend', `<div class="fd-into" style="left:${at.x}px;top:${at.y}px;width:200px;height:40px"></div>`);
      return;
    }
    const t = dropTarget(at.pi, at.x, at.y, drag.path);
    drag.target = t;
    if (t.into) ov.insertAdjacentHTML('beforeend', `<div class="fd-into" style="left:${t.into.x}px;top:${t.into.y}px;width:${t.into.w}px;height:${t.into.h}px"></div>`);
    if (t.line) ov.insertAdjacentHTML('beforeend', `<div class="fd-ins" style="left:${t.line.x}px;top:${t.line.y - 1}px;width:${t.line.w}px"></div>`);
  }
  function drop(d, ev) {
    const at = pageAt(ev);
    if (d.mode === 'resize') { if (d.result) commit(f => { Object.assign(getAt(f, d.path), d.result.props); if (d.result.cols) getAt(f, d.path).columns.forEach((c, i) => { c.width = d.result.cols[i]; }); }); return; }
    if (!at) { if (d.mode === 'move') drawPages(); return; }
    if (d.positioned) {
      const x = Math.max(0, round(at.x - (d.dx || 0))), y = Math.max(0, round(at.y - (d.dy || 0)));
      if (d.mode === 'move') return commit(f => { const it = getAt(f, d.path); it.x = x; it.y = y; });
      const zone = y < D.layout.top ? 'header' : y >= D.layout.footerTop ? 'footer' : 'content';
      let np; commit(f => { np = insert(f, zone, (f[zone] || []).length, { ...d.make(), x, y }); }); if (np) select(np);
      return;
    }
    const t = dropTarget(at.pi, at.x, at.y, d.path);
    if (d.mode === 'move') return moveTo(d.path, t.list, t.index);
    let np; commit(f => { np = insert(f, t.list, t.index, d.data ? dataItem(d.data, t.list) : d.make()); });
    if (np) select(np);
  }
  // resizing with the handle: the size properties of the item (or the widths of two neighbouring columns)
  function resize(at) {
    const it = getAt(D.form, drag.path), k = kindOf(it), b = drag.box;
    const w = Math.max(10, round(at.x - b.x)), h = Math.max(4, round(at.y - b.y));
    let props = {};
    if (drag.h === 'col') {
      const cols = it.columns.map(c => Number(c.width || 1));
      const cb = drag.cols, i = drag.c, pair = cols[i] + cols[i + 1], span = cb[i].w + cb[i + 1].w;
      const left = Math.max(0.1, Math.min(0.9, (at.x - cb[i].x) / span));
      const nc = [...cols]; nc[i] = round(pair * left * 10) / 10; nc[i + 1] = round((pair - nc[i]) * 10) / 10;
      drag.result = { props: {}, cols: nc };
      const bx = canvas.querySelector(`.fd-box[data-path="${drag.path}.columns.${i}"]`); if (bx) bx.style.width = `${Math.max(10, at.x - cb[i].x)}px`;
      return;
    }
    if (k === 'box') props = { width: w, height: h };
    else if (k === 'image') props = { width: w };
    else if (k === 'barcode') props = /^(qr|datamatrix|aztec)$/.test(it.barcode) ? { size: Math.max(w, 10) } : { width: w, height: Math.max(10, h - (it.text === false ? 4 : 14)) };
    else if (k === 'input') props = it.type === 'checkbox' ? {} : { width: w, height: Math.max(12, h - (it.label ? 20 : 6)) };
    else if (k === 'space') props = { space: h };
    drag.result = { props };
    const el = canvas.querySelector(`.fd-box[data-path="${drag.path}"]`); if (el) { el.style.width = `${w}px`; el.style.height = `${h}px`; }
  }
  $('.fd-lib').addEventListener('pointerdown', e => {
    const t = e.target.closest('.fd-tile'); if (!t || e.button) return;
    e.preventDefault();
    startDrag(e, { mode: 'new', label: t.textContent.trim(), make: () => libItem(t.dataset.lib), positioned: t.dataset.lib === 'box' });
  });
  $('.fd-data').addEventListener('pointerdown', e => {
    const t = e.target.closest('.fd-d[data-d]'); if (!t || e.button) return;
    e.preventDefault();
    startDrag(e, { mode: 'new', label: `{${t.dataset.d}}`, data: { path: t.dataset.d, type: t.dataset.t, value: t.dataset.v } });
  });
  canvas.addEventListener('pointerdown', e => {
    if (e.button) return;
    canvas.focus({ preventScroll: true });
    const hnd = e.target.closest('.fd-h');
    const at = pageAt(e);
    if (hnd && at) {
      e.preventDefault(); e.stopPropagation();
      const bx = D.layout.boxes.find(b => b.path === D.sel && b.page === at.pi);
      const cols = D.layout.boxes.filter(b => b.page === at.pi && b.kind === 'column' && b.path.startsWith(`${D.sel}.columns.`));
      return startDrag(e, { mode: 'resize', path: D.sel, h: hnd.dataset.h, c: Number(hnd.dataset.c), box: bx, cols });
    }
    const el = e.target.closest('.fd-box');
    if (!el || !at) { if (!e.target.closest('.fd-page')) return; return select(null); }
    // the innermost object under the pointer (Esc: its parent)
    let p = el.dataset.path.replace(/\.columns\.\d+$/, '');
    if (D.sel && p.startsWith(`${D.sel}.`)) p = D.sel;   // inside the selected subform: the subform
    e.preventDefault();
    const it = getAt(D.form, p);
    const b = D.layout.boxes.find(x => x.path === p && x.page === at.pi) || {};
    startDrag(e, { mode: 'move', path: p, label: NAME[kindOf(it)], positioned: !!b.positioned, dx: at.x - b.x, dy: at.y - b.y, click: () => select(p) });
    if (D.sel !== p) select(p, true);
  });
  canvas.addEventListener('dblclick', e => { const el = e.target.closest('.fd-box'); if (!el) return; const p = el.dataset.path.replace(/\.columns\.\d+$/, ''); select(p); const f = $('.fd-props [data-k="text"], .fd-props [data-k="value"], .fd-props textarea'); f?.focus(); f?.select?.(); });

  // ---------------------------------------------------------------- properties
  const F = (k, label, type = 'text', opts) => ({ k, label, type, opts });
  const COMMON = [F('if', 'Condition (shown when)', 'expr'), F('style', 'Style', 'style'), F('keepTogether', 'Keep together on one page', 'bool'), F('pageBreakBefore', 'Page break before', 'bool')];
  const ALIGN = ['', 'left', 'center', 'right'];
  const FORMATS = ['', 'date', 'time', 'amount', 'number', 'integer', 'currency', 'upper', 'lower', 'alpha'];
  const PROPS = {
    text: [F('text', 'Text ({field}, **bold**, {= expression})', 'area'), F('size', 'Size', 'num'), F('bold', 'Bold', 'bool'), F('italic', 'Italic', 'bool'), F('color', 'Color', 'color'), F('align', 'Align', 'sel', ALIGN), F('mono', 'Monospace', 'bool'), F('lineHeight', 'Line height', 'num')],
    textModule: [F('textModule', 'Text module', 'textmod'), F('size', 'Size', 'num'), F('color', 'Color', 'color'), F('align', 'Align', 'sel', ALIGN)],
    fields: [F('fields', 'Fields', 'fields'), F('size', 'Size', 'num')],
    table: [F('table', 'Data (table)', 'path'), F('columns', 'Columns', 'columns'), F('groupBy', 'Group by (field)'), F('groupHeader', 'Group header text'), F('subtotal', 'Subtotals', 'bool'), F('totalLabel', 'Total label'), F('stripes', 'Stripes', 'bool'), F('headerColor', 'Header color', 'color'), F('size', 'Size', 'num')],
    repeat: [F('repeat', 'Data (table): once per line', 'path')],
    image: [F('image', 'Image (file in src/ or {field})', 'image'), F('width', 'Width', 'num'), F('height', 'Height', 'num'), F('align', 'Align', 'sel', ALIGN)],
    barcode: [F('barcode', 'Type', 'sel', ['qr', 'datamatrix', 'gs1datamatrix', 'pdf417', 'aztec', 'maxicode', 'code128', 'gs1-128', 'code39', 'code93', 'ean13', 'ean8', 'upca', 'upce', 'itf', 'itf14', 'codabar']), F('value', 'Value'), F('size', 'Size (2D codes)', 'num'), F('width', 'Width', 'num'), F('height', 'Height', 'num'), F('text', 'Human-readable text', 'bool3'), F('align', 'Align', 'sel', ALIGN), F('level', 'Error correction (QR)', 'sel', ['', 'L', 'M', 'Q', 'H'])],
    columns: [F('gap', 'Gap', 'num'), F('columns', 'Column widths (relative)', 'colwidths')],
    box: [F('x', 'X', 'num'), F('y', 'Y', 'num'), F('width', 'Width', 'num'), F('height', 'Height (empty: grows)', 'num'), F('border', 'Border', 'color'), F('fill', 'Fill', 'color'), F('padding', 'Padding', 'num')],
    input: [F('input', 'Field name'), F('type', 'Type', 'sel', ['text', 'multiline', 'checkbox', 'dropdown', 'signature']), F('label', 'Caption'), F('value', 'Default value ({field})'), F('options', 'Options (drop-down)', 'list'), F('width', 'Width', 'num'), F('height', 'Height', 'num'), F('required', 'Required', 'bool'), F('readOnly', 'Read-only', 'bool'), F('maxLength', 'Max. length', 'num'), F('tooltip', 'Tooltip'), F('calc', 'Calculation (fillable: recalculated in the PDF)', 'expr')],
    line: [F('color', 'Color', 'color')],
    space: [F('space', 'Height', 'num')],
    pagebreak: [],
  };
  const FORM_PROPS = [F('title', 'Title'), F('dataProvider', 'Data provider (service definition)'), F('locale', 'Locale', 'sel', ['', 'en_US', 'en_GB', 'de_DE', 'fr_FR', 'es_ES', 'it_IT', 'nl_NL', 'ja_JP']), F('page.size', 'Page size', 'sel', ['A4', 'A5', 'A3', 'Letter', 'Legal']), F('page.orientation', 'Orientation', 'sel', ['portrait', 'landscape']), F('page.margin', 'Margins (pt, mm)', 'margin'),
    F('interactive', 'Fillable (interactive)', 'bool3'), F('font', 'Font (helvetica, times, courier or a font of "fonts")'), F('watermark', 'Watermark text', 'wm'), F('headerLine', 'Line below the header', 'bool3'), F('pdfa', 'PDF/A (archiving)', 'bool'), F('security.ownerPassword', 'Permissions password (encrypts the PDF)'), F('security.permissions', 'Allowed (print, printHigh, fill, copy, modify, annotate, accessibility, assemble)', 'list'), F('variables', 'Variables (calculations)', 'kv'), F('texts', 'Text modules', 'texts')];
  const getP = (o, k) => k.split('.').reduce((a, x) => a?.[x], o);
  const setP = (o, k, v) => { const ks = k.split('.'); const last = ks.pop(); let t = o; for (const x of ks) { if (!t[x] || typeof t[x] !== 'object') t[x] = {}; t = t[x]; } if (v === undefined || v === '' || v === null) delete t[last]; else t[last] = v; };
  function fieldHtml(f, v) {
    const id = `fd-${f.k.replace(/\W/g, '_')}`;
    const lab = `<label for="${id}">${esc(f.label)}</label>`;
    switch (f.type) {
      case 'area': return `${lab}<textarea id="${id}" data-k="${f.k}" rows="3">${esc(v ?? '')}</textarea>`;
      case 'num': return `${lab}<input id="${id}" data-k="${f.k}" data-t="num" value="${esc(v ?? '')}" placeholder="auto">`;
      case 'bool': return `<label class="chk"><input type="checkbox" data-k="${f.k}" data-t="bool"${v ? ' checked' : ''}> ${esc(f.label)}</label>`;
      case 'bool3': return `${lab}<select id="${id}" data-k="${f.k}" data-t="bool3"><option value="">default</option><option value="true"${v === true ? ' selected' : ''}>yes</option><option value="false"${v === false ? ' selected' : ''}>no</option></select>`;
      case 'sel': return `${lab}<select id="${id}" data-k="${f.k}">${f.opts.map(o => `<option${String(v ?? '') === o ? ' selected' : ''} value="${esc(o)}">${esc(o || 'default')}</option>`).join('')}${v !== undefined && !f.opts.includes(String(v)) ? `<option selected>${esc(v)}</option>` : ''}</select>`;
      case 'color': return `${lab}<span class="fd-color"><input type="color" data-k="${f.k}" data-t="colorpick" value="${/^#[0-9a-f]{6}$/i.test(v || '') ? v : '#000000'}"><input id="${id}" data-k="${f.k}" value="${esc(v ?? '')}" placeholder="none"></span>`;
      case 'expr': return `${lab}<input id="${id}" data-k="${f.k}" class="mono" value="${esc(v ?? '')}" placeholder="e.g. status = 'O' and net > 1000">`;
      case 'path': return `${lab}<input id="${id}" data-k="${f.k}" list="fd-tables" value="${esc(v ?? '')}">`;
      case 'list': return `${lab}<input id="${id}" data-k="${f.k}" data-t="list" value="${esc(Array.isArray(v) ? v.join(', ') : v ?? '')}" placeholder="A, B, C">`;
      case 'image': return `${lab}<input id="${id}" data-k="${f.k}" list="fd-assets" value="${esc(v ?? '')}">`;
      case 'style': return Object.keys(D.form.styles || {}).length ? `${lab}<select id="${id}" data-k="${f.k}"><option value="">none</option>${Object.keys(D.form.styles).map(s => `<option${v === s ? ' selected' : ''}>${esc(s)}</option>`).join('')}</select>` : '';
      case 'textmod': return `${lab}<select id="${id}" data-k="${f.k}">${Object.keys(D.form.texts || {}).map(s => `<option${v === s ? ' selected' : ''}>${esc(s)}</option>`).join('')}${v && !(D.form.texts || {})[v] ? `<option selected>${esc(v)}</option>` : ''}</select><small class="fd-note">Text modules are defined in the form properties.</small>`;
      case 'margin': return `${lab}<input id="${id}" data-k="${f.k}" data-t="margin" value="${esc(typeof v === 'object' && v ? [v.top, v.right, v.bottom, v.left].join(' ') : v ?? '')}" placeholder="40 or top right bottom left">`;
      case 'wm': return `${lab}<input id="${id}" data-k="${f.k}" data-t="wm" value="${esc(typeof v === 'object' && v ? v.text : v ?? '')}">${typeof v === 'object' && v ? `<small class="fd-note">Shown when ${esc(v.if || 'always')}</small>` : ''}`;
      case 'fields': return `<label>${esc(f.label)}</label><div class="fd-grid g3" data-k="fields">${(v || []).map((r, i) => `<input data-r="${i}" data-c="0" value="${esc(r[0])}" placeholder="Label"><input data-r="${i}" data-c="1" value="${esc(r[1])}" placeholder="{field}" class="mono"><select data-r="${i}" data-c="2">${FORMATS.map(o => `<option${(r[2] || '') === o ? ' selected' : ''}>${o}</option>`).join('')}</select><button class="x" data-del="${i}" title="Remove">×</button>`).join('')}</div><button class="btn sm" data-add="fields">+ Field</button>`;
      case 'columns': return `<label>${esc(f.label)}</label><div class="fd-cols" data-k="columns">${(v || []).map((c, i) => `<div class="fd-colrow"><input data-i="${i}" data-c="title" value="${esc(c.title ?? '')}" placeholder="Title"><input data-i="${i}" data-c="field" value="${esc(c.field ?? '')}" placeholder="field" class="mono"><input data-i="${i}" data-c="width" value="${esc(c.width ?? '')}" placeholder="width" class="w"><select data-i="${i}" data-c="format">${FORMATS.map(o => `<option${(c.format || '') === o ? ' selected' : ''}>${o}</option>`).join('')}</select><select data-i="${i}" data-c="align">${ALIGN.map(o => `<option${(c.align || '') === o ? ' selected' : ''}>${o}</option>`).join('')}</select><select data-i="${i}" data-c="total" title="Total of the column">${['', 'sum', 'avg', 'count', 'min', 'max'].map(o => `<option${(D.selItem?.total?.[c.field] || '') === o ? ' selected' : ''} value="${o}">${o || 'no total'}</option>`).join('')}</select><input data-i="${i}" data-c="calc" value="${esc(c.calc ?? '')}" placeholder="calculation, e.g. quantity * price" class="mono wide"><span class="ops"><button data-mv="${i}" data-d="-1" title="Left">←</button><button data-mv="${i}" data-d="1" title="Right">→</button><button class="x" data-del="${i}" title="Remove">×</button></span></div>`).join('')}</div><button class="btn sm" data-add="columns">+ Column</button>`;
      case 'colwidths': return `<label>${esc(f.label)}</label><div class="fd-grid g2" data-k="colwidths">${(v || []).map((c, i) => `<span>Column ${i + 1}</span><input data-i="${i}" value="${esc(c.width ?? 1)}">`).join('')}</div><button class="btn sm" data-add="column">+ Column</button> <button class="btn sm" data-add="uncolumn"${(v || []).length < 2 ? ' disabled' : ''}>− Column</button>`;
      case 'kv': return `<label>${esc(f.label)}</label><div class="fd-grid g2b" data-k="${f.k}">${Object.entries(v || {}).map(([n, x]) => `<input data-n="${esc(n)}" data-c="n" value="${esc(n)}" class="mono"><input data-n="${esc(n)}" data-c="v" value="${esc(x)}" class="mono"><button class="x" data-del="${esc(n)}">×</button>`).join('')}</div><button class="btn sm" data-add="${f.k}">+ Variable</button>`;
      case 'texts': return `<label>${esc(f.label)}</label><div class="fd-texts" data-k="texts">${Object.entries(v || {}).map(([n, x]) => `<div class="fd-tm"><b>${esc(n)}</b><button class="x" data-del="${esc(n)}">×</button>${Object.entries(typeof x === 'string' ? { en: x } : x).map(([l, t]) => `<label>${esc(l)}</label><textarea data-n="${esc(n)}" data-l="${esc(l)}" rows="2">${esc(t)}</textarea>`).join('')}<button class="btn sm" data-addlang="${esc(n)}">+ Language</button></div>`).join('')}</div><button class="btn sm" data-add="texts">+ Text module</button>`;
      default: return `${lab}<input id="${id}" data-k="${f.k}" value="${esc(v ?? '')}">`;
    }
  }
  function drawProps() {
    const P = $('.fd-props');
    const p = D.sel, it = p ? getAt(D.form, p) : null;
    D.selItem = it;
    const tables = [];
    const walk = (v, path) => { if (Array.isArray(v)) { tables.push(path); if (v[0] && typeof v[0] === 'object') for (const [k, x] of Object.entries(v[0])) walk(x, `${path}.${k}`); } else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, path ? `${path}.${k}` : k); };
    walk(D.data, '');
    const lists = `<datalist id="fd-tables">${tables.map(t => `<option value="${esc(t)}">`).join('')}</datalist><datalist id="fd-assets">${D.assets.filter(a => !/\.ttf$/i.test(a)).map(a => `<option value="${esc(a)}">`).join('')}</datalist>`;
    if (!it) {
      $('.fd-ptitle').textContent = 'Form properties';
      P.innerHTML = FORM_PROPS.map(f => `<div class="fd-f">${fieldHtml(f, getP(D.form, f.k))}</div>`).join('') + lists;
    } else {
      const k = kindOf(it);
      $('.fd-ptitle').textContent = `${NAME[k] || k}`;
      P.innerHTML = `<div class="fd-path">${esc(p)}</div>${(PROPS[k] || []).map(f => `<div class="fd-f">${fieldHtml(f, it[f.k])}</div>`).join('')}<div class="fd-sub">Behaviour</div>${COMMON.map(f => `<div class="fd-f">${fieldHtml(f, it[f.k])}</div>`).join('')}
        <details class="fd-json"><summary>JSON of this object</summary><textarea class="mono" rows="8" data-json>${esc(formatLayout(it))}</textarea></details>${lists}`;
    }
  }
  const P = $('.fd-props');
  const valOf = el => {
    const t = el.dataset.t, v = el.value;
    if (t === 'bool') return el.checked || undefined;
    if (t === 'bool3') return v === '' ? undefined : v === 'true';
    if (t === 'num') return v.trim() === '' ? undefined : (/^-?[\d.]+$/.test(v.trim()) ? Number(v) : v.trim());
    if (t === 'list') return v.trim() ? v.split(',').map(s => s.trim()).filter(Boolean) : undefined;
    if (t === 'margin') { const n = v.trim().split(/\s+/).filter(Boolean).map(x => (/^[\d.]+$/.test(x) ? Number(x) : x)); return n.length === 4 ? { top: n[0], right: n[1], bottom: n[2], left: n[3] } : n.length ? n[0] : undefined; }
    return v;
  };
  function onProp(e, final) {
    const el = e.target;
    const target = D.sel;
    const edit = fn => commit(f => { const o = target ? getAt(f, target) : f; if (!o) return false; return fn(o, f); }, `${target}|${el.dataset.k || el.closest('[data-k]')?.dataset.k}|${el.dataset.r ?? el.dataset.i ?? el.dataset.n ?? ''}|${el.dataset.c ?? ''}`, true);
    if (el.matches('[data-json]')) { if (!final) return; let v; try { v = JSON.parse(el.value); } catch (x) { toast?.(`Not valid JSON: ${x.message}`); return; } return commit(f => { const [lp, i] = parentOf(target); listAt(f, lp)[i] = v; }); }
    const box = el.closest('[data-k]');
    if (box && !el.dataset.k) {
      const k = box.dataset.k;
      if (k === 'fields') return edit(o => { const r = o.fields[el.dataset.r]; r[el.dataset.c] = el.value; if (el.dataset.c === '2' && !el.value) r.length = 2; });
      if (k === 'columns') return edit(o => { const c = o.columns[el.dataset.i], key = el.dataset.c; if (key === 'total') { o.total ||= {}; if (el.value) o.total[c.field] = el.value; else { delete o.total[c.field]; if (!Object.keys(o.total).length) delete o.total; } return; } const v = key === 'width' ? (el.value.trim() === '' ? undefined : Number(el.value) || el.value) : el.value; if (v === undefined || v === '') delete c[key]; else c[key] = v; });
      if (k === 'colwidths') return edit(o => { o.columns[el.dataset.i].width = Number(el.value) || 1; });
      if (k === 'variables') { if (!final && el.dataset.c === 'n') return; if (el.dataset.c === 'n') setTimeout(drawProps); return edit(o => { const vars = o.variables || {}; const out = {}; for (const [n, x] of Object.entries(vars)) { if (n === el.dataset.n) { if (el.dataset.c === 'n') out[el.value || n] = x; else out[n] = el.value; } else out[n] = x; } o.variables = out; }); }
      if (k === 'texts') return edit(o => { const t = o.texts[el.dataset.n]; if (typeof t === 'string') o.texts[el.dataset.n] = { en: t }; o.texts[el.dataset.n][el.dataset.l] = el.value; });
      return;
    }
    if (!el.dataset.k) return;
    let v = valOf(el), k = el.dataset.k;
    if (el.dataset.t === 'colorpick') { v = el.value; el.parentElement.querySelector('input:not([type=color])').value = v; }
    if (el.dataset.t === 'wm') return edit(o => { if (typeof o.watermark === 'object' && o.watermark) { if (v) o.watermark.text = v; else delete o.watermark; } else if (v) o.watermark = v; else delete o.watermark; });
    if (k === 'text' && target) return edit(o => { o.text = v; });
    if (k === 'type' && target) return edit(o => { o.type = v; if (v === 'dropdown' && !o.options) o.options = ['A', 'B']; });
    edit(o => { setP(o, k, v); for (const g of ['page', 'security']) if (k.startsWith(`${g}.`) && o[g] && !Object.keys(o[g]).length) delete o[g]; });
  }
  P.addEventListener('input', e => { if (e.target.matches('textarea, input:not([type=checkbox]):not([type=color])')) onProp(e, false); });
  P.addEventListener('change', e => onProp(e, true));
  P.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    const target = D.sel;
    const edit = fn => commit(f => { const o = target ? getAt(f, target) : f; return fn(o, f); });
    if (b.dataset.add === 'fields') return edit(o => { o.fields.push(['Label', '{field}']); });
    if (b.dataset.add === 'columns') return edit(o => { o.columns.push({ title: 'Column', field: 'field' }); });
    if (b.dataset.add === 'column') return edit(o => { o.columns.push({ width: 1, items: [] }); });
    if (b.dataset.add === 'uncolumn') return edit(o => { const c = o.columns.pop(); o.columns.at(-1).items.push(...(c.items || [])); });
    if (b.dataset.add === 'variables') return edit(o => { o.variables ||= {}; let n = 'var1', k = 1; while (o.variables[n]) n = `var${++k}`; o.variables[n] = '0'; });
    if (b.dataset.add === 'texts') return edit(o => { o.texts ||= {}; let n = 'text1', k = 1; while (o.texts[n]) n = `text${++k}`; o.texts[n] = { en: 'Text' }; });
    if (b.dataset.addlang) { const l = prompt('Language (e.g. de, fr)'); if (l) edit(o => { const t = o.texts[b.dataset.addlang]; o.texts[b.dataset.addlang] = { ...(typeof t === 'string' ? { en: t } : t), [l.toLowerCase()]: '' }; }); return; }
    if (b.dataset.mv !== undefined) return edit(o => { const i = Number(b.dataset.mv), j = i + Number(b.dataset.d); if (j < 0 || j >= o.columns.length) return false; [o.columns[i], o.columns[j]] = [o.columns[j], o.columns[i]]; });
    if (b.dataset.del !== undefined) {
      const box = b.closest('[data-k]').dataset.k;
      return edit(o => { if (box === 'fields') o.fields.splice(b.dataset.del, 1); else if (box === 'columns') o.columns.splice(b.dataset.del, 1); else if (box === 'variables') { delete o.variables[b.dataset.del]; if (!Object.keys(o.variables).length) delete o.variables; } else if (box === 'texts') { delete o.texts[b.dataset.del]; if (!Object.keys(o.texts).length) delete o.texts; } });
    }
  });

  // ---------------------------------------------------------------- selection, commands, keys
  function select(p, quiet) { D.sel = p || null; D.scrollTree = true; markSel(); drawTree(); drawProps(); if (!quiet) { const b = canvas.querySelector(`.fd-box[data-path="${p}"]`); b?.scrollIntoView?.({ block: 'nearest' }); } }
  function command(a) {
    if (a === 'undo') return undoRedo(D.undo, D.redo);
    if (a === 'redo') return undoRedo(D.redo, D.undo);
    if (a === 'zin' || a === 'zout') { D.zoom = Math.max(0.3, Math.min(3, zoom() * (a === 'zin' ? 1.2 : 1 / 1.2))); return drawPages(); }
    if (a === 'fit') { D.zoom = 0; return drawPages(); }
    const p = D.sel; if (!p) return;
    const [lp, i] = parentOf(p);
    if (a === 'del') { commit(f => { removeAt(f, p); }); const l = listAt(D.form, lp) || []; return select(l.length ? `${lp}.${Math.min(i, l.length - 1)}` : null); }
    if (a === 'dup') { commit(f => { listAt(f, lp).splice(i + 1, 0, clone(getAt(f, p))); }); return select(`${lp}.${i + 1}`); }
    if (a === 'up' && i > 0) { commit(f => { const l = listAt(f, lp); [l[i - 1], l[i]] = [l[i], l[i - 1]]; }); return select(`${lp}.${i - 1}`); }
    if (a === 'down' && i < (listAt(D.form, lp) || []).length - 1) { commit(f => { const l = listAt(f, lp); [l[i + 1], l[i]] = [l[i], l[i + 1]]; }); return select(`${lp}.${i + 1}`); }
  }
  $('.fd-tools').addEventListener('click', e => { const b = e.target.closest('[data-a]'); if (b) command(b.dataset.a); });
  const onKey = e => {
    if (!host.isConnected || host.closest('[hidden]')) return;
    if (e.target.closest?.('input, textarea, select') || !host.contains(document.activeElement)) return;
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); return command(e.shiftKey ? 'redo' : 'undo'); }
    if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); return command('redo'); }
    if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); return command('dup'); }
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); return command('del'); }
    if (e.key === 'Escape') { const up = D.sel && D.sel.replace(/\.(items|box|columns\.\d+\.items)\.\d+$/, ''); return select(up && up !== D.sel ? up : null); }
    const it = D.sel && getAt(D.form, D.sel);
    if (it && e.key.startsWith('Arrow')) {
      e.preventDefault();
      if (e.altKey || !it.box) return command(e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? 'up' : 'down');
      const s = e.shiftKey ? 10 : 1, dx = e.key === 'ArrowLeft' ? -s : e.key === 'ArrowRight' ? s : 0, dy = e.key === 'ArrowUp' ? -s : e.key === 'ArrowDown' ? s : 0;
      commit(f => { const o = getAt(f, D.sel); o.x = Math.max(0, round((Number(o.x) || 0) + dx)); o.y = Math.max(0, round((Number(o.y) || 0) + dy)); }, `nudge|${D.sel}`);
    }
  };
  document.addEventListener('keydown', onKey);
  const ro = new ResizeObserver(() => { if (!D.zoom && D.layout) drawPages(); });
  ro.observe(canvas);

  // data records of the data provider
  api('GET', `/a/${app}/api/forms/records?name=${encodeURIComponent(name)}`).then(r => {
    if (!r.records?.length) return;
    $('.fd-rec').insertAdjacentHTML('beforeend', `<optgroup label="${esc(r.entity)}">${r.records.map(x => `<option value='${esc(JSON.stringify(x.keys))}'>${esc(x.text)}</option>`).join('')}</optgroup>`);
  }).catch(() => {});
  $('.fd-rec').onchange = e => { D.keys = e.target.value ? JSON.parse(e.target.value) : null; relayout(true); };

  function refreshAll() { drawTree(); drawProps(); relayout(); }
  D.lastText = getText(); parse();
  if (D.form) refreshAll(); else relayout(true);
  return {
    // the source changed outside the designer (Source view, the chat agent)
    refresh() { const t = getText(); if (t === D.lastText) return; D.lastText = t; parse(); if (D.error) return relayout(true); if (D.sel && getAt(D.form, D.sel) === undefined) D.sel = null; drawTree(); drawProps(); relayout(); },
    destroy() { document.removeEventListener('keydown', onKey); ro.disconnect(); clearTimeout(timer); },
  };
}
