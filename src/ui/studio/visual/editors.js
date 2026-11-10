// The Design view of tables, CDS view entities, behavior definitions, metadata extensions and classic screens:
// forms instead of syntax. Each editor reads the editor's text into a model (models.js), changes it and writes clean
// source back (the file stays the source; Source shows it), with undo and redo.
import * as M from './models.js';
import * as C from './classic.js';
import * as FM from './fm.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clone = v => JSON.parse(JSON.stringify(v));
export const visualKind = f => (/^src\/.*\.tabl\.cds$/i.test(f) ? 'table' : /^src\/.*\.ddls\.asddls$/i.test(f) ? 'view' : /^src\/.*\.bdef\.asbdef$/i.test(f) ? 'bdef' : /^src\/.*\.ddlx\.asddlxs$/i.test(f) ? 'ddlx'
  : /^src\/.*\.prog\.xml$/i.test(f) ? 'prog' : /^src\/.*\.doma\.xml$/i.test(f) ? 'doma' : /^src\/.*\.dtel\.xml$/i.test(f) ? 'dtel' : /^src\/.*\.ttyp\.xml$/i.test(f) ? 'ttyp'
  : /^src\/.*\.sfpi\.json$/i.test(f) ? 'sfpi' : /^src\/.*\.msag\.json$/i.test(f) ? 'msag' : /^src\/[\w$#]+\.fugr\.(?!sapl)(?!l\w+(top|uxx)\.abap$)[\w$#]+\.abap$/i.test(f) ? 'fm' : null);
// the DDIC data types (domains, data elements)
const DDIC = [['CHAR', 'Character string'], ['NUMC', 'Numeric text'], ['DEC', 'Packed number'], ['CURR', 'Amount'], ['QUAN', 'Quantity'], ['CUKY', 'Currency key'], ['UNIT', 'Unit'], ['DATS', 'Date'], ['TIMS', 'Time'], ['INT1', '1-byte integer'], ['INT2', '2-byte integer'], ['INT4', '4-byte integer'], ['INT8', '8-byte integer'], ['FLTP', 'Floating point'], ['STRG', 'String'], ['SSTR', 'Short string'], ['RAW', 'Bytes'], ['RSTR', 'Byte string'], ['LANG', 'Language'], ['UTCL', 'UTC time stamp'], ['DATN', 'Date (database)'], ['TIMN', 'Time (database)'], ['D16N', 'Decfloat 16'], ['D34N', 'Decfloat 34'], ['ACCP', 'Posting period'], ['CLNT', 'Client']];
const FIXED_LEN = { CUKY: 5, DATS: 8, TIMS: 6, INT1: 3, INT2: 5, INT4: 10, INT8: 19, FLTP: 16, STRG: 0, RSTR: 0, LANG: 1, UTCL: 27, DATN: 8, TIMN: 6, D16N: 16, D34N: 34, ACCP: 6, CLNT: 3 };
const HAS_DEC = /^(DEC|CURR|QUAN|FLTP)$/;
const TYPES = ['char', 'numc', 'dec', 'curr', 'quan', 'cuky', 'unit', 'dats', 'tims', 'utclong', 'int1', 'int2', 'int4', 'int8', 'fltp', 'string', 'sstring', 'rawstring', 'raw', 'lang', 'clnt', 'datn', 'timn'];
const ELEMS = ['sysuuid_x16', 'abp_creation_user', 'abp_creation_tstmpl', 'abp_lastchange_user', 'abp_lastchange_tstmpl', 'abp_locinst_lastchange_tstmpl', 'abp_boolean', 'waers', 'meins', 'matnr', 'kunnr', 'lifnr', 'werks_d', 'bukrs'];
const NEEDS_LEN = /^(char|numc|dec|curr|quan|raw|sstring)$/;
const NEEDS_DEC = /^(dec|curr|quan)$/;

export function mountVisual(host, { kind, file, getText, setText, api, app }) {
  const V = { model: null, error: null, undo: [], redo: [], last: null, sel: -1, selC: -1, ent: 0, screen: 0, flow: null };
  host.innerHTML = `<div class="ve"><div class="ve-bar"><b class="ve-title"></b><span class="ve-kind"></span><span class="spacer"></span>
    <span class="ve-msg"></span><button class="btn sm" data-a="undo" title="Undo (Ctrl+Z)">↶</button><button class="btn sm" data-a="redo" title="Redo (Ctrl+Shift+Z)">↷</button></div>
    <div class="ve-body"></div></div>`;
  const $ = s => host.querySelector(s);
  const body = $('.ve-body');
  // a program's .prog.xml: screens, GUI status and text elements; each part is written only when it changed
  const parseProg = x => ({ screens: C.parseScreens(x), cua: C.parseCua(x), tpool: C.parseTpool(x) });
  const writeProg = m => {
    let x = getText();
    const o = V.orig || {};
    if (JSON.stringify(m.screens) !== JSON.stringify(o.screens)) x = C.writeScreens(x, m.screens);
    if (JSON.stringify(m.cua) !== JSON.stringify(o.cua)) x = C.writeCua(x, m.cua);
    if (JSON.stringify(m.tpool) !== JSON.stringify(o.tpool)) x = C.writeTpool(x, m.tpool);
    return x;
  };
  const P = { table: [M.parseTable, M.writeTable, 'Table'], view: [M.parseView, M.writeView, 'CDS view entity'], bdef: [M.parseBdef, M.writeBdef, 'Behavior definition'], ddlx: [M.parseDdlx, M.writeDdlx, 'Metadata extension'],
    prog: [parseProg, writeProg, 'Program'], doma: [C.parseDomaXml, m => C.writeDomaXml(getText(), m), 'Domain'], dtel: [C.parseDtelXml, m => C.writeDtelXml(getText(), m), 'Data element'],
    ttyp: [C.parseTtypXml, m => C.writeTtypXml(getText(), m), 'Table type'],
    msag: [t => ({ messages: Object.entries(JSON.parse(t || '{}')).map(([nr, text]) => ({ nr, text: String(text) })) }),
      m => `${JSON.stringify(Object.fromEntries(m.messages.filter(x => String(x.nr).trim()).map(x => [String(x.nr).padStart(3, '0'), x.text]).sort(([a], [b]) => a.localeCompare(b))), null, 2)}\n`, 'Message class'],
    sfpi: [t => { const o = JSON.parse(t || '{}'); return { description: o.description || '', parameters: o.parameters || [], global: o.global || [], init: o.init || '', rest: Object.fromEntries(Object.entries(o).filter(([k]) => !['description', 'parameters', 'global', 'init'].includes(k))) }; },
      m => `${JSON.stringify({ description: m.description, parameters: m.parameters, ...(m.global.length ? { global: m.global } : {}), ...(m.init.trim() ? { init: m.init } : {}), ...m.rest }, null, 1)}\n`, 'Form interface'], fm: [FM.parseFm, m => FM.writeFm(getText(), m), 'Function module'] }[kind];
  const read = () => {
    try { V.model = P[0](getText()); V.error = null; if (kind === 'fm' && !V.model.name) throw new Error('No FUNCTION statement: edit it in the Source view'); } catch (e) { V.model = null; V.error = e.message; }
    if (kind === 'prog' && V.model) V.orig = clone(V.model);
    V.last = getText();
  };
  const write = m => P[1](m);
  // the app's dictionary objects (suggestions of the type inputs)
  V.meta = { tables: [], structures: [], dataElements: [], domains: [], tableTypes: [] };
  api('GET', `/a/${app}/api/generate/kinds`).then(r => { V.meta = { tables: r.tables.map(t => t.name), structures: r.structures || [], dataElements: r.dataElements || [], domains: r.domains || [], tableTypes: r.tableTypes || [] }; const dl = host.querySelector('#veTypes'); if (dl) dl.innerHTML = typeOptions();
    // the views that check names against the app's objects are drawn again (unless the user is typing in them)
    V.metaLoaded = true;
    if (['dtel', 'doma', 'table', 'ttyp'].includes(kind) && V.model && host.isConnected && !host.contains(document.activeElement)) draw(); }).catch(() => {});
  const typeOptions = () => [...V.meta.dataElements, ...V.meta.structures, ...V.meta.tables, ...V.meta.tableTypes].map(x => `<option value="${esc(String(x).toUpperCase())}">`).join('');
  host.insertAdjacentHTML('beforeend', `<datalist id="veTypes">${typeOptions()}</datalist><datalist id="veDomains"></datalist>`);
  // a change: mutate a copy of the model, write the source, remember the old text for undo
  // the focused input of a view (by its data attribute): focused again after a redraw (Tab out of a grid cell moves
  // on to the next cell, not out of the view)
  const FOCUS_ATTRS = ['data-p', 'data-fcode', 'data-key', 'data-menu', 'data-ann', 'data-ref', 'data-ck', 'data-sel', 'data-seld', 'data-sym', 'data-head', 'data-tt', 'data-tch', 'data-h', 'data-do-type', 'data-fl'];
  function focusKey() {
    const a = document.activeElement;
    if (!a || !host.contains(a)) return null;
    const attr = FOCUS_ATTRS.find(x => a.hasAttribute(x));
    return attr ? [attr, a.getAttribute(attr)] : null;
  }
  function restoreFocus(k) {
    if (!k) return;
    const el = [...host.querySelectorAll(`[${k[0]}]`)].find(x => x.getAttribute(k[0]) === k[1]);
    if (el && document.activeElement !== el) { el.focus(); if (el.select && el.type !== 'checkbox' && el.tagName === 'INPUT') try { el.select(); } catch {} }
  }
  function change(fn, keepFocus) {
    const m = clone(V.model);
    if (fn(m) === false) return;
    const text = write(m);
    if (text === getText()) { V.model = m; return; }
    V.undo.push(getText()); if (V.undo.length > 200) V.undo.shift(); V.redo = [];
    V.model = m; V.last = text; setText(text);
    if (!keepFocus) {
      // a 'change' event (Tab / click out of a cell): drawn after the focus moved on, then that element focused again
      if (window.event?.type === 'change') setTimeout(() => { const fk = focusKey(); draw(); restoreFocus(fk); }, 0);
      else { const fk = focusKey(); draw(); restoreFocus(fk); }
    } else { msg(); if (kind === 'ddlx') { const side = host.querySelector('.ve-side'); if (side) side.innerHTML = ddlxPreview(V.model); }
      if (kind === 'prog' && V.part === 'screens') {
        const sc = V.model.screens.screens[V.screen], f = sc?.fields[V.sel], c = sc?.containers?.[V.selC];
        const el = host.querySelector(`.ve-el[data-fi="${V.sel}"]`), ce = host.querySelector(`.ve-cont[data-ci="${V.selC}"]`);
        if (f && el) { el.textContent = elLabel(f); Object.assign(el.style, { left: `${(f.column - 1) * CW}px`, top: `${(f.line - 1) * RH}px`, width: `${f.length * CW}px` }); }
        if (c && ce) Object.assign(ce.style, { left: `${(c.column - 1) * CW}px`, top: `${(c.line - 1) * RH}px`, width: `${c.length * CW}px`, height: `${Math.max(1, c.height) * RH}px` });
        const cv = host.querySelector('.ve-canvas');
        if (cv && sc) { const rows = Math.max(sc.lines, ...sc.fields.map(x => x.line)); cv.style.height = `${Math.max(6, rows) * RH}px`; cv.style.width = `${sc.columns * CW}px`; }
      } }
  }
  function undoRedo(from, to) { if (!from.length) return; to.push(getText()); const t = from.pop(); V.last = t; setText(t); read(); draw(); }
  $('.ve-bar').addEventListener('click', e => { const a = e.target.closest('[data-a]')?.dataset.a; if (a === 'undo') undoRedo(V.undo, V.redo); if (a === 'redo') undoRedo(V.redo, V.undo); });
  const onKey = e => { if (!host.isConnected || !host.contains(document.activeElement) && document.activeElement !== document.body) return; const mod = e.metaKey || e.ctrlKey;
    // the painter: Delete removes the selected element or container (not while typing in a field)
    if ((e.key === 'Delete' || e.key === 'Backspace') && kind === 'prog' && V.part === 'screens' && !e.target.closest('input,textarea,select,[contenteditable]') && (V.sel >= 0 || V.selC >= 0)) {
      e.preventDefault();
      if (V.selC >= 0) { progAct('delC', {}); return; }
      const i = V.sel; change(m => { m.screens.screens[V.screen].fields.splice(i, 1); }); V.sel = -1; draw(); return;
    } if (mod && e.key.toLowerCase() === 'z' && !e.target.closest('input,textarea')) { e.preventDefault(); undoRedo(e.shiftKey ? V.redo : V.undo, e.shiftKey ? V.undo : V.redo); } };
  document.addEventListener('keydown', onKey);
  const msg = () => {
    const m = kind === 'table' && V.model ? M.checkTable(V.model) : kind === 'fm' && V.model ? FM.checkFm(V.model) : [];
    $('.ve-msg').className = `ve-msg${m.length ? ' bad' : ''}`;
    $('.ve-msg').textContent = m.length ? `⚠ ${m.slice(0, 3).join(' · ')}` : '';
  };
  // inputs: data-p="path.to.value" on the model (numbers / booleans by input type)
  const setPath = (m, p, v) => { const s = p.split('.'); let o = m; for (const k of s.slice(0, -1)) o = o[/^\d+$/.test(k) ? Number(k) : k]; o[s.at(-1)] = v; };
  body.addEventListener('input', e => { const i = e.target.closest('[data-p]'); if (!i || i.type === 'checkbox' || i.tagName === 'SELECT') return; change(m => setPath(m, i.dataset.p, i.type === 'number' ? (i.value === '' ? null : Number(i.value)) : i.value), true); });
  body.addEventListener('change', e => { const i = e.target.closest('[data-p]'); if (i && (i.type === 'checkbox' || i.tagName === 'SELECT')) change(m => setPath(m, i.dataset.p, i.type === 'checkbox' ? i.checked : i.value)); });
  body.addEventListener('click', e => { const b = e.target.closest('[data-do]'); if (b) { e.preventDefault(); act(b.dataset.do, b.dataset, b); } });
  const inp = (p, v, a = '') => `<input data-p="${p}" value="${esc(v ?? '')}" ${a}>`;
  const num = (p, v, a = '') => `<input type="number" data-p="${p}" value="${v ?? ''}" ${a}>`;
  const chk = (p, v, t = '') => `<label class="ve-chk"><input type="checkbox" data-p="${p}"${v ? ' checked' : ''}> ${t}</label>`;
  // a value that is not among the options stays selectable (never silently the first option)
  const sel = (p, v, opts) => `<select data-p="${p}">${[...opts, ...(v !== undefined && v !== null && v !== '' && !opts.some(o => String(Array.isArray(o) ? o[0] : o) === String(v)) ? [[v, `${v} (unknown)`]] : [])].map(o => (Array.isArray(o) ? o : [o, o])).map(([x, l]) => `<option value="${esc(x)}"${String(v) === String(x) ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
  const rowBtns = (list, i) => `<td class="ve-ops"><button class="x" data-do="up" data-l="${list}" data-i="${i}" title="Move up">↑</button><button class="x" data-do="down" data-l="${list}" data-i="${i}" title="Move down">↓</button><button class="x" data-do="del" data-l="${list}" data-i="${i}" title="Remove">✕</button></td>`;
  const getList = (m, p) => p.split('.').reduce((o, k) => o[/^\d+$/.test(k) ? Number(k) : k], m);

  // ---------------------------------------------------------------- actions
  async function act(a, d, el) {
    if (a === 'up' || a === 'down' || a === 'del') return change(m => { const l = getList(m, d.l), i = Number(d.i); if (a === 'del') l.splice(i, 1); else { const j = a === 'up' ? i - 1 : i + 1; if (j < 0 || j >= l.length) return false; [l[i], l[j]] = [l[j], l[i]]; } });
    if (a === 'tab') { V.ent = Number(d.i); if (V.screen !== Number(d.i)) { V.screen = Number(d.i); V.sel = -1; V.selC = -1; if (kind === 'prog') return loadFlow(); } return draw(); }
    if (a === 'part') { V.part = d.p; return draw(); }
    if (kind === 'table') return tableAct(a);
    if (kind === 'view') return viewAct(a, d);
    if (kind === 'bdef') return bdefAct(a, d);
    if (kind === 'ddlx') return ddlxAct(a, d);
    if (kind === 'prog') return progAct(a, d, el);
    if (kind === 'doma' || kind === 'dtel' || kind === 'ttyp') return ddicAct(a, d);
    if (kind === 'fm') return fmAct(a, d);
    if (kind === 'msag') return change(m => { const used = new Set(m.messages.map(x => Number(x.nr))); let n = 1; while (used.has(n)) n++; m.messages.push({ nr: String(n).padStart(3, '0'), text: '' }); });
    if (kind === 'sfpi') return change(m => { if (a === 'addImp') m.parameters.push({ name: `IV_PARAM${m.parameters.length + 1}`, type: 'STRING' }); if (a === 'addGlob') m.global.push({ name: `GV_DATA${m.global.length + 1}`, type: 'STRING' }); });
  }

  // ---------------------------------------------------------------- table and structure
  const field = (name, type, length = null, o = {}) => ({ key: false, name, type, builtin: TYPES.includes(type), length, decimals: null, notNull: false, fk: '', anns: {}, ...o });
  function tableAct(a) {
    change(m => {
      const has = n => m.fields.some(f => f.name === n);
      if (a === 'addField') m.fields.push(field(`field${m.fields.length + 1}`, 'char', 20));
      if (a === 'addInclude') { const n = (host.querySelector('#veInc')?.value || '').trim().toLowerCase(); if (!n) return false; m.fields.push({ include: n, suffix: '', anns: {} }); }
      if (a === 'client' && !has('client')) m.fields.unshift(field('client', 'clnt', null, { key: true, notNull: true }));
      if (a === 'uuid') { const k = `${m.name.replace(/^z|_a$|_d$/gi, '')}_uuid`; if (!has(k)) m.fields.splice(m.fields.filter(f => f.key).length, 0, { ...field(k, 'sysuuid_x16'), builtin: false, key: true, notNull: true }); }
      if (a === 'admin') for (const [n, t] of [['created_by', 'abp_creation_user'], ['created_at', 'abp_creation_tstmpl'], ['last_changed_by', 'abp_lastchange_user'], ['last_changed_at', 'abp_lastchange_tstmpl'], ['local_last_changed_at', 'abp_locinst_lastchange_tstmpl']]) if (!has(n)) m.fields.push({ ...field(n, t), builtin: false });
    });
  }
  const enumVal = v => (v && typeof v === 'object' ? v.$e : v ?? '');
  function drawTable() {
    const t = V.model, structure = t.kind === 'structure';
    const H = t.header;
    const hsel = (k, opts, def = '') => `<select data-h="${k}">${opts.map(([v, l]) => `<option value="${esc(v)}"${String(enumVal(H[k]) ?? def) === String(v) || (H[k] === undefined && v === def) ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
    // a reference field only for amounts and quantities (built-in curr / quan, or a data element of such a domain)
    V.dtelTypes ||= {};
    const pend = t.fields.filter(f => !f.raw && !f.include && !f.builtin && /^z/i.test(f.type) && V.dtelTypes[f.type.toLowerCase()] === undefined);
    if (pend.length) Promise.all(pend.map(async f => { const d = await dtelInfo(f.type); V.dtelTypes[f.type.toLowerCase()] = d?.datatype || ''; })).then(() => { if (pend.some(f => /CURR|QUAN/.test(V.dtelTypes[f.type.toLowerCase()])) && host.isConnected) { const fk = focusKey(); draw(); restoreFocus(fk); } });
    const isRef = f => (f.builtin && /^(curr|quan)$/.test(f.type)) || (!f.builtin && !!M.refOf(f)) || (!f.builtin && /CURR|QUAN/.test(V.dtelTypes[f.type.toLowerCase()] || ''));
    const refCands = f => t.fields.filter(x => !x.raw && !x.include && (f.builtin && f.type === 'quan' ? x.type === 'unit' || /meins|unit/i.test(x.name) : x.type === 'cuky' || x.type === 'unit' || /waers|curr|meins|unit/i.test(x.name))).map(x => x.name);
    body.innerHTML = `<div class="ve-sec"><div class="ve-grid2"><label>${structure ? 'Structure' : 'Table'}</label><b>${esc(t.name)}</b><label>Description</label>${inp('header.EndUserText.label', H['EndUserText.label'])}
      ${structure ? '' : `<label>Delivery class</label>${hsel('AbapCatalog.deliveryClass', [['A', 'A · Application table (master and transaction data)'], ['C', 'C · Customizing'], ['L', 'L · Temporary data'], ['G', 'G · Customizing, protected'], ['E', 'E · Control table'], ['S', 'S · System table']], 'A')}
      <label>Data maintenance</label>${hsel('AbapCatalog.dataMaintenance', [['RESTRICTED', 'Display / maintenance restricted'], ['ALLOWED', 'Display / maintenance allowed'], ['NOT_ALLOWED', 'Not allowed']], 'RESTRICTED')}`}</div></div>
      ${structure ? '' : `<details class="ve-sec ve-tech"${V.techOpen ? ' open' : ''}><summary><h4>Technical settings</h4></summary><div class="ve-grid2">
        <label>Data class</label>${hsel('AbapCatalog.technicalSettings.dataClass', [['APPL0', 'APPL0 · Master data'], ['APPL1', 'APPL1 · Transaction data'], ['APPL2', 'APPL2 · Organization and customizing'], ['USER', 'USER · Customer data class']], 'APPL0')}
        <label>Size category</label>${hsel('AbapCatalog.technicalSettings.sizeCategory', [['0', '0 · up to ~ 10 000 rows'], ['1', '1 · up to ~ 50 000'], ['2', '2 · up to ~ 200 000'], ['3', '3 · up to ~ 800 000'], ['4', '4 · more']], '0')}
        <label>Buffering</label>${hsel('AbapCatalog.technicalSettings.buffering', [['NOT_ALLOWED', 'Not allowed'], ['ALLOWED_BUT_OFF', 'Allowed but switched off'], ['ON', 'Switched on']], 'NOT_ALLOWED')}
        ${enumVal(H['AbapCatalog.technicalSettings.buffering']) === 'ON' ? `<label>Buffering type</label>${hsel('AbapCatalog.technicalSettings.bufferingType', [['SINGLE', 'Single records'], ['GENERIC', 'Generic area'], ['FULL', 'Fully buffered']], 'SINGLE')}` : ''}</div>
        <p class="ve-note">The runtime does not buffer; the settings are kept for the export to an SAP system (DD09L).</p></details>`}
      <div class="ve-sec"><h4>${structure ? 'Components' : 'Fields'} <span class="ve-btns"><button class="btn sm" data-do="addField">+ ${structure ? 'Component' : 'Field'}</button>${structure ? '' : '<button class="btn sm" data-do="client">+ Client</button><button class="btn sm" data-do="uuid">+ UUID key</button><button class="btn sm" data-do="admin">+ Admin fields</button>'}</span></h4>
      <div class="ve-scroll"><table class="ve-tab"><tr>${structure ? '' : '<th>Key</th>'}<th>Name</th><th>Type</th><th title="Length">Len.</th><th title="Decimals">Dec.</th>${structure ? '' : '<th title="Not null">NN</th>'}<th title="The currency key / unit field of an amount or a quantity">Ref. field</th>${structure ? '' : '<th title="Foreign key: the values must exist in this table">Check table</th>'}<th>Label</th><th></th></tr>
      ${t.fields.map((f, i) => f.raw ? `<tr><td colspan="${structure ? 7 : 9}" class="ve-raw">${esc(f.raw)} <small>(kept as written)</small></td>${rowBtns('fields', i)}</tr>`
        : f.include ? `<tr class="ve-inc">${structure ? '' : '<td></td>'}<td colspan="${structure ? 6 : 8}"><span class="ve-note">include</span> ${inp(`fields.${i}.include`, f.include, 'class="mono w14" list="veTypes"')} <span class="ve-note">with suffix</span> ${inp(`fields.${i}.suffix`, f.suffix, 'class="mono w6" placeholder="(none)"')}</td>${rowBtns('fields', i)}</tr>`
        : `<tr>
        ${structure ? '' : `<td>${chk(`fields.${i}.key`, f.key)}</td>`}<td>${inp(`fields.${i}.name`, f.name, 'class="mono w9"')}</td>
        <td><select data-do-type="${i}" class="w10">${[...TYPES.map(x => `<option value="abap.${x}"${f.builtin && f.type === x ? ' selected' : ''}>abap.${x}</option>`), `<optgroup label="Data elements and structures">${[...new Set([...ELEMS, ...V.meta.dataElements, ...V.meta.structures, ...(f.builtin ? [] : [f.type])])].map(x => `<option value="${x}"${!f.builtin && f.type === x ? ' selected' : ''}>${x}</option>`).join('')}</optgroup>`].join('')}</select></td>
        <td>${f.builtin && NEEDS_LEN.test(f.type) ? num(`fields.${i}.length`, f.length, 'min="1" class="w5"') : ''}</td><td>${f.builtin && NEEDS_DEC.test(f.type) ? num(`fields.${i}.decimals`, f.decimals, 'min="0" class="w4"') : ''}</td>
        ${structure ? '' : `<td>${chk(`fields.${i}.notNull`, f.notNull)}</td>`}
        <td>${isRef(f) ? `<input class="mono w6" data-ref="${i}" list="veRef${i}" value="${esc(M.refOf(f))}" placeholder="${f.builtin && f.type === 'quan' ? 'unit' : 'currency'}"><datalist id="veRef${i}">${refCands(f).map(x => `<option value="${esc(x)}">`).join('')}</datalist>` : ''}</td>
        ${structure ? '' : `<td><input class="mono w7" data-ck="${i}" list="veTabs" value="${esc(M.checkTableOf(f))}" placeholder="—"></td>`}
        <td><input data-ann="${i}" class="w8" value="${esc(f.anns['EndUserText.label'] ?? '')}"></td>${rowBtns('fields', i)}</tr>`).join('')}</table></div>
      <datalist id="veTabs">${V.meta.tables.map(x => `<option value="${esc(x)}">`).join('')}</datalist>
      <p class="ve-note">Other data element or structure: <input class="mono" id="veDtel" list="veTypes" placeholder="e.g. zpo_ebeln"> <button class="btn sm" data-do="dtel">Use for the last ${structure ? 'component' : 'field'}</button>
        &nbsp; Include structure: <input class="mono" id="veInc" list="veTypes" placeholder="e.g. zpo_s_admin"> <button class="btn sm" data-do="addInclude">+ Include</button></p></div>`;
    body.querySelectorAll('[data-do-type]').forEach(s => s.onchange = () => change(m => { const f = m.fields[Number(s.dataset.doType)]; const v = s.value; if (v.startsWith('abap.')) { f.builtin = true; f.type = v.slice(5); if (!NEEDS_LEN.test(f.type)) f.length = null; else f.length ||= 10; if (!NEEDS_DEC.test(f.type)) f.decimals = null; else f.decimals ??= 2; } else { f.builtin = false; f.type = v; f.length = f.decimals = null; } }));
    body.querySelector('[data-do="dtel"]').onclick = () => { const v = body.querySelector('#veDtel').value.trim().toLowerCase(); if (v) change(m => { const f = m.fields.filter(x => !x.raw && !x.include).at(-1); if (f) Object.assign(f, { builtin: false, type: v, length: null, decimals: null }); }); };
    // label annotations are keys with a dot: written through a dedicated handler
    body.querySelectorAll('[data-ann]').forEach(i => { const idx = Number(i.dataset.ann); i.oninput = () => change(m => { const f = m.fields[idx]; if (i.value) f.anns['EndUserText.label'] = i.value; else delete f.anns['EndUserText.label']; }, true); });
    body.querySelectorAll('[data-ref]').forEach(i => { const idx = Number(i.dataset.ref); i.onchange = () => change(m => { const f = m.fields[idx]; for (const k of M.REF_ANNS) delete f.anns[k]; const v = i.value.trim().toLowerCase(); if (v) f.anns[(f.builtin && f.type === 'quan') || m.fields.find(x => x.name === v)?.type === 'unit' || /meins|unit/.test(v) ? M.REF_ANNS[1] : M.REF_ANNS[0]] = `${m.name}.${v}`; }); });
    // a check table: its key fields decide the where clause (the field checked against its last key)
    body.querySelectorAll('[data-ck]').forEach(i => { const idx = Number(i.dataset.ck); i.onchange = () => { V.pending = (async () => {
      const v = i.value.trim().toLowerCase();
      let keys = null;
      if (v) {
        const tx = await fetch(`/a/${app}/api/source/${encodeURIComponent(`src/${v}.tabl.cds`)}`).then(r => (r.ok ? r.text() : '')).catch(() => '');
        try { keys = tx ? M.parseTable(tx).fields.filter(x => x.key && !x.raw && !x.include).map(x => ({ name: x.name, client: x.type === 'clnt' })) : null; } catch { keys = null; }
        if (!keys) msgText(`${v.toUpperCase()} is not a table of this app: the foreign key compares ${V.model.fields[idx].name} with a field of the same name`);
      }
      change(m => { const f = m.fields[idx]; f.fk = v ? M.foreignKey(m, f, v, keys) : ''; });
    })(); }; });
    body.querySelectorAll('[data-h]').forEach(x => x.onchange = () => change(m => { const k = x.dataset.h; const v = x.value; if (/sizeCategory$/.test(k)) { if (v === '0') delete m.header[k]; else m.header[k] = Number(v); } else if ((/dataClass$/.test(k) && v === 'APPL0') || (/buffering$/.test(k) && v === 'NOT_ALLOWED')) delete m.header[k]; else m.header[k] = { $e: v }; }));
    const tech = body.querySelector('.ve-tech'); if (tech) tech.ontoggle = () => { V.techOpen = tech.open; };
    const lbl = body.querySelector('[data-p="header.EndUserText.label"]'); lbl.removeAttribute('data-p'); lbl.oninput = () => change(m => { if (lbl.value) m.header['EndUserText.label'] = lbl.value; else delete m.header['EndUserText.label']; }, true);
  }

  // ---------------------------------------------------------------- view entity
  let sourceFields = null;
  async function loadSource(name) {
    sourceFields = null;
    for (const f of [`src/${name.toLowerCase()}.tabl.cds`, `src/${name.toLowerCase()}.ddls.asddls`]) {
      const t = await fetch(`/a/${app}/api/source/${encodeURIComponent(f)}`).then(r => (r.ok ? r.text() : null)).catch(() => null);
      if (!t) continue;
      try { sourceFields = f.endsWith('.cds') ? M.parseTable(t).fields.filter(x => !x.raw && x.type !== 'clnt').map(x => ({ name: x.name, key: x.key, alias: M.camel(x.name) })) : M.parseView(t).elements.map(e => ({ name: e.alias || e.expr, key: e.key, alias: e.alias || e.expr })); } catch { /* not designable */ }
      break;
    }
    if (kind === 'view') drawView();
  }
  function viewAct(a, d) {
    change(m => {
      if (a === 'addEl') m.elements.push({ key: false, expr: 'field', alias: 'Field', anns: {} });
      if (a === 'addSrc') { const f = sourceFields.find(x => x.name === d.n); const proj = m.sourceKind === 'projection'; m.elements.splice(m.elements.filter(e => !/^_/.test(e.expr)).length, 0, { key: f.key, expr: f.name, alias: proj ? '' : f.alias, anns: {} }); }
      if (a === 'addAllSrc') for (const f of sourceFields) if (!m.elements.some(e => e.expr === f.name)) m.elements.splice(m.elements.filter(e => !/^_/.test(e.expr)).length, 0, { key: f.key, expr: f.name, alias: m.sourceKind === 'projection' ? '' : f.alias, anns: {} });
      if (a === 'addAssoc') m.assocs.push({ kind: 'association', card: '[0..1]', target: 'ZI_Target', alias: '_Target', on: '$projection.Field = _Target.Field' });
      if (a === 'exposeAssoc') { const as = m.assocs[Number(d.i)]; if (!m.elements.some(e => e.expr === as.alias)) m.elements.push({ key: false, expr: as.alias, alias: '', anns: {} }); }
    });
  }
  const ANN_EDIT = [['EndUserText.label', 'Label'], ['ObjectModel.text.element', 'Text element'], ['Semantics.amount.currencyCode', 'Currency of amount'], ['Semantics.quantity.unitOfMeasure', 'Unit of quantity']];
  const SEM = ['', 'Semantics.user.createdBy', 'Semantics.systemDateTime.createdAt', 'Semantics.user.lastChangedBy', 'Semantics.systemDateTime.lastChangedAt', 'Semantics.systemDateTime.localInstanceLastChangedAt', 'Semantics.currencyCode', 'Semantics.unitOfMeasure'];
  function drawView() {
    const v = V.model;
    const semOf = e => SEM.find(s => s && e.anns[s] === true) || '';
    const vh = e => (Array.isArray(e.anns['Consumption.valueHelpDefinition']) ? e.anns['Consumption.valueHelpDefinition'][0]?.entity || {} : {});
    body.innerHTML = `<div class="ve-sec"><div class="ve-grid2">
      <label>View entity</label><b>${esc(v.name)}</b>
      <label>Root entity</label>${chk('root', v.root, 'root (the top of a business object)')}
      <label>Label</label><input id="veLbl" value="${esc(v.header['EndUserText.label'] ?? '')}">
      <label>${v.sourceKind === 'projection' ? 'Projection on' : 'Select from'}</label><span>${inp('source', v.source, 'class="mono"')} as ${inp('sourceAlias', v.sourceAlias, 'class="mono w8" placeholder="alias"')}${v.sourceKind === 'projection' ? ` provider contract ${sel('contract', v.contract, ['', 'transactional_query', 'transactional_interface', 'analytical_query'])}` : ''}</span></div></div>
      <div class="ve-sec"><h4>Fields <span class="ve-btns"><button class="btn sm" data-do="addEl">+ Field</button>${sourceFields ? '<button class="btn sm" data-do="addAllSrc">+ All fields of the source</button>' : ''}</span></h4>
      ${sourceFields ? `<div class="ve-chips">${sourceFields.filter(f => !v.elements.some(e => e.expr === f.name || e.expr.endsWith(`.${f.name}`))).map(f => `<button class="ve-chip" data-do="addSrc" data-n="${esc(f.name)}" title="Add">+ ${esc(f.name)}</button>`).join('') || '<span class="ve-note">All source fields are in the view.</span>'}</div>` : ''}
      <table class="ve-tab"><tr><th>Key</th><th>Element / expression</th><th>Alias</th><th>Label</th><th>Semantics</th><th>Text / value help</th><th></th></tr>
      ${v.elements.map((e, i) => `<tr><td>${chk(`elements.${i}.key`, e.key)}</td><td>${inp(`elements.${i}.expr`, e.expr, 'class="mono"')}</td><td>${inp(`elements.${i}.alias`, e.alias, 'class="mono w10"')}</td>
        <td><input data-ann="${i}|EndUserText.label" value="${esc(e.anns['EndUserText.label'] ?? '')}"></td>
        <td><select data-sem="${i}">${SEM.map(s => `<option value="${s}"${semOf(e) === s ? ' selected' : ''}>${s ? s.replace(/^Semantics\./, '') : '—'}</option>`).join('')}</select></td>
        <td class="ve-small"><input data-ann="${i}|ObjectModel.text.element" value="${esc((e.anns['ObjectModel.text.element'] || [])[0] ?? '')}" placeholder="text element"> <input data-vh="${i}|name" value="${esc(vh(e).name ?? '')}" placeholder="value help view" class="w10"> <input data-vh="${i}|element" value="${esc(vh(e).element ?? '')}" placeholder="element" class="w8"></td>${rowBtns('elements', i)}</tr>`).join('')}</table></div>
      <div class="ve-sec"><h4>Associations and compositions <span class="ve-btns"><button class="btn sm" data-do="addAssoc">+ Association</button></span></h4>
      <table class="ve-tab"><tr><th>Kind</th><th>Cardinality</th><th>Target</th><th>Alias</th><th>On condition</th><th></th><th></th></tr>
      ${v.assocs.map((a, i) => a.raw ? `<tr><td colspan="6" class="ve-raw">${esc(a.raw)}</td>${rowBtns('assocs', i)}</tr>` : `<tr><td>${sel(`assocs.${i}.kind`, a.kind, ['association', 'composition', 'parent'])}</td><td>${inp(`assocs.${i}.card`, a.card, 'class="w6 mono"')}</td><td>${inp(`assocs.${i}.target`, a.target, 'class="mono"')}</td><td>${inp(`assocs.${i}.alias`, a.alias, 'class="mono w8"')}</td><td>${a.kind === 'composition' ? '<span class="ve-note">(the child defines the condition)</span>' : inp(`assocs.${i}.on`, a.on, 'class="mono wide"')}</td><td><button class="btn sm" data-do="exposeAssoc" data-i="${i}" title="Add the association to the field list">expose</button></td>${rowBtns('assocs', i)}</tr>`).join('')}</table></div>
      ${v.tail ? `<div class="ve-sec"><h4>After the field list</h4><pre class="ve-raw">${esc(v.tail)}</pre></div>` : ''}`;
    const lbl = body.querySelector('#veLbl'); lbl.oninput = () => change(m => { if (lbl.value) m.header['EndUserText.label'] = lbl.value; else delete m.header['EndUserText.label']; }, true);
    body.querySelectorAll('[data-ann]').forEach(x => x.oninput = () => change(m => { const [i, p] = x.dataset.ann.split('|'); const e = m.elements[Number(i)]; if (!x.value) delete e.anns[p]; else e.anns[p] = p === 'ObjectModel.text.element' ? [x.value] : x.value; }, true));
    body.querySelectorAll('[data-sem]').forEach(x => x.onchange = () => change(m => { const e = m.elements[Number(x.dataset.sem)]; for (const s of SEM) if (s) delete e.anns[s]; if (x.value) e.anns[x.value] = true; }));
    body.querySelectorAll('[data-vh]').forEach(x => x.oninput = () => change(m => { const [i, k] = x.dataset.vh.split('|'); const e = m.elements[Number(i)]; const cur = vh(e); const ent = { ...cur, [k]: x.value }; if (!ent.name && !ent.element) delete e.anns['Consumption.valueHelpDefinition']; else e.anns['Consumption.valueHelpDefinition'] = [{ entity: { name: ent.name || '', element: ent.element || '' } }]; }, true));
    void ANN_EDIT;
  }

  // ---------------------------------------------------------------- behavior definition
  const items = (e, k) => e.items.map((x, i) => [x, i]).filter(([x]) => x.k === k);
  function bdefAct(a, d) {
    change(m => {
      const e = m.entities[V.ent];
      if (a === 'addEnt') m.entities.push({ name: 'ZR_Child', alias: 'Child', table: '', draftTable: '', lock: 'dependent by _Parent', auth: 'dependent by _Parent', etag: '', totalEtag: '', other: '', items: m.projection ? [{ k: 'use', op: 'update' }, { k: 'use', op: 'delete' }] : [{ k: 'op', op: 'update', features: '' }, { k: 'op', op: 'delete', features: '' }] });
      if (a === 'op') { const has = e.items.findIndex(x => (x.k === 'op' || x.k === 'use') && x.op === d.op); if (has >= 0) e.items.splice(has, 1); else e.items.splice(0, 0, m.projection ? { k: 'use', op: d.op } : { k: 'op', op: d.op, features: '' }); }
      if (a === 'addAction') e.items.push({ k: 'action', internal: false, static: false, factory: false, features: '', name: 'newAction', param: '', result: '[1] $self' });
      if (a === 'addDet') e.items.push({ k: 'det', name: 'setDefaults', when: 'modify', ops: ['create'], fields: [] });
      if (a === 'addVal') e.items.push({ k: 'val', name: 'validateData', ops: ['create'], fields: [] });
      if (a === 'addAssoc') e.items.push(m.projection ? { k: 'useAssoc', name: '_Child', create: false } : { k: 'assoc', name: '_Child', create: true, features: '' });
      if (a === 'addUseAction') e.items.push({ k: 'useAction', name: d.n || 'action' });
      if (a === 'addPair') items(e, 'mapping')[0]?.[0].pairs.push(['Field', 'field']);
      if (a === 'addMapping') e.items.push({ k: 'mapping', table: e.table, corresponding: false, pairs: [] });
      if (a === 'fieldsAdd') { let f = items(e, 'field').find(([x]) => x.props.join(',') === d.p)?.[0]; if (!f) { f = { k: 'field', props: d.p.split(','), fields: [] }; e.items.push(f); } }
    });
  }
  async function fillMapping() {
    const e = V.model.entities[V.ent];
    const tableName = (items(e, 'mapping')[0]?.[0].table || e.table || '').toLowerCase();
    const t = await fetch(`/a/${app}/api/source/${encodeURIComponent(`src/${tableName}.tabl.cds`)}`).then(r => (r.ok ? r.text() : null)).catch(() => null);
    if (!t) { msgText(`Table ${tableName} not found in this app`); return; }
    const cols = M.parseTable(t).fields.filter(f => !f.raw && f.type !== 'clnt').map(f => f.name);
    change(m => { const en = m.entities[V.ent]; let mp = items(en, 'mapping')[0]?.[0]; if (!mp) { mp = { k: 'mapping', table: tableName, corresponding: false, pairs: [] }; en.items.push(mp); } for (const c of cols) if (!mp.pairs.some(p => p[1] === c)) mp.pairs.push([M.camel(c), c]); });
  }
  const msgText = t => { $('.ve-msg').className = 've-msg bad'; $('.ve-msg').textContent = t; };
  function drawBdef() {
    const b = V.model, e = b.entities[V.ent] || b.entities[0];
    V.ent = Math.max(0, b.entities.indexOf(e));
    const E = `entities.${V.ent}`;
    const opOn = op => e?.items.some(x => (x.k === 'op' || x.k === 'use') && x.op === op);
    const fieldRow = (props, label) => { const f = items(e, 'field').find(([x]) => x.props.join(',').replace(/\s/g, '') === props.replace(/\s/g, '')); return `<label>${label}</label>${f ? `<input data-fields="${f[1]}" value="${esc(f[0].fields.join(', '))}" class="mono wide">` : `<button class="btn sm" data-do="fieldsAdd" data-p="${props}">+ add</button>`}`; };
    body.innerHTML = `<div class="ve-sec"><div class="ve-grid2">
      ${b.projection ? '<label>Kind</label><b>projection</b>' : `<label>Implementation</label>${inp('kind', b.kind, 'class="mono"')}<label>Behavior pool</label>${inp('cls', b.cls, 'class="mono" placeholder="zbp_r_…"')}`}
      <label>Strict mode</label>${sel('strict', b.strict, [['', 'off'], '1', '2'])}<label>Draft</label>${chk('draft', b.draft, b.projection ? 'use draft' : 'with draft (draft tables per entity)')}</div></div>
      <div class="ve-tabs">${b.entities.map((x, i) => `<button class="ve-tabb${i === V.ent ? ' on' : ''}" data-do="tab" data-i="${i}">${esc(x.alias || x.name)}</button>`).join('')}${b.projection ? '' : '<button class="btn sm" data-do="addEnt">+ Entity</button>'}</div>
      ${!e ? '' : `<div class="ve-sec"><div class="ve-grid2"><label>Entity</label><span>${inp(`${E}.name`, e.name, 'class="mono"')} alias ${inp(`${E}.alias`, e.alias, 'class="mono w8"')}</span>
      ${b.projection ? '' : `<label>Persistent table</label>${inp(`${E}.table`, e.table, 'class="mono"')}${b.draft ? `<label>Draft table</label>${inp(`${E}.draftTable`, e.draftTable, 'class="mono"')}` : ''}
      <label>Lock</label>${inp(`${E}.lock`, e.lock, 'class="mono" placeholder="master | dependent by _Parent"')}<label>Authorization</label>${inp(`${E}.auth`, e.auth, 'class="mono" placeholder="master ( instance ) | dependent by _Parent"')}
      <label>ETag</label>${inp(`${E}.etag`, e.etag, 'class="mono" placeholder="master field, e.g. LocalLastChangedAt"')}<label>Total ETag</label>${inp(`${E}.totalEtag`, e.totalEtag, 'class="mono"')}${e.other ? `<label>Also</label><code>${esc(e.other)}</code>` : ''}`}</div></div>
      <div class="ve-sec"><h4>Operations</h4>${['create', 'update', 'delete'].map(op => `<label class="ve-chk"><input type="checkbox" data-do="op" data-op="${op}"${opOn(op) ? ' checked' : ''}> ${op}</label>`).join(' ')}
        ${b.projection ? '' : items(e, 'op').map(([x, i]) => ` <span class="ve-note">${x.op}: </span>${sel(`${E}.items.${i}.features`, x.features, [['', 'always'], ['instance', 'feature control (instance)'], ['global', 'feature control (global)']])}`).join('')}</div>
      ${b.projection ? '' : `<div class="ve-sec"><h4>Field properties</h4><div class="ve-grid2">${fieldRow('readonly', 'Read only')}${fieldRow('mandatory', 'Mandatory')}${fieldRow('numbering : managed, readonly', 'Managed numbering (UUID key)')}</div></div>`}
      <div class="ve-sec"><h4>${b.projection ? 'Actions used' : 'Actions'} <span class="ve-btns"><button class="btn sm" data-do="${b.projection ? 'addUseAction' : 'addAction'}">+ Action</button></span></h4>
        <table class="ve-tab">${b.projection ? items(e, 'useAction').map(([x, i]) => `<tr><td>${inp(`${E}.items.${i}.name`, x.name, 'class="mono"')}</td>${rowBtns(`${E}.items`, i)}</tr>`).join('') : `<tr><th>Name</th><th>Internal</th><th>Static</th><th>Features</th><th>Parameter</th><th>Result</th><th></th></tr>${items(e, 'action').map(([x, i]) => `<tr><td>${inp(`${E}.items.${i}.name`, x.name, 'class="mono"')}</td><td>${chk(`${E}.items.${i}.internal`, x.internal)}</td><td>${chk(`${E}.items.${i}.static`, x.static)}</td><td>${sel(`${E}.items.${i}.features`, x.features, [['', '—'], 'instance', 'global'])}</td><td>${inp(`${E}.items.${i}.param`, x.param, 'class="mono w10" placeholder="abstract entity"')}</td><td>${inp(`${E}.items.${i}.result`, x.result, 'class="mono w8" placeholder="[1] $self"')}</td>${rowBtns(`${E}.items`, i)}</tr>`).join('')}`}</table></div>
      ${b.projection ? '' : `<div class="ve-sec"><h4>Determinations <span class="ve-btns"><button class="btn sm" data-do="addDet">+ Determination</button></span></h4><table class="ve-tab"><tr><th>Name</th><th>When</th><th>On</th><th>Fields</th><th></th></tr>
        ${items(e, 'det').map(([x, i]) => `<tr><td>${inp(`${E}.items.${i}.name`, x.name, 'class="mono"')}</td><td>${sel(`${E}.items.${i}.when`, x.when, ['modify', 'save'])}</td><td>${['create', 'update', 'delete'].map(o => `<label class="ve-chk"><input type="checkbox" data-trig="${i}|${o}"${x.ops.includes(o) ? ' checked' : ''}>${o}</label>`).join('')}</td><td><input data-tf="${i}" value="${esc(x.fields.join(', '))}" class="mono"></td>${rowBtns(`${E}.items`, i)}</tr>`).join('')}</table></div>
      <div class="ve-sec"><h4>Validations <span class="ve-btns"><button class="btn sm" data-do="addVal">+ Validation</button></span></h4><table class="ve-tab"><tr><th>Name</th><th>On save for</th><th>Fields</th><th></th></tr>
        ${items(e, 'val').map(([x, i]) => `<tr><td>${inp(`${E}.items.${i}.name`, x.name, 'class="mono"')}</td><td>${['create', 'update', 'delete'].map(o => `<label class="ve-chk"><input type="checkbox" data-trig="${i}|${o}"${x.ops.includes(o) ? ' checked' : ''}>${o}</label>`).join('')}</td><td><input data-tf="${i}" value="${esc(x.fields.join(', '))}" class="mono"></td>${rowBtns(`${E}.items`, i)}</tr>`).join('')}</table></div>`}
      <div class="ve-sec"><h4>Associations <span class="ve-btns"><button class="btn sm" data-do="addAssoc">+ Association</button></span></h4><table class="ve-tab">
        ${[...items(e, 'assoc'), ...items(e, 'useAssoc')].map(([x, i]) => `<tr><td>${inp(`${E}.items.${i}.name`, x.name, 'class="mono"')}</td><td>${chk(`${E}.items.${i}.create`, x.create, 'create by association')}</td>${rowBtns(`${E}.items`, i)}</tr>`).join('')}</table></div>
      ${b.projection ? '' : `<div class="ve-sec"><h4>Mapping <span class="ve-btns">${items(e, 'mapping').length ? '<button class="btn sm" data-do="addPair">+ Pair</button>' : '<button class="btn sm" data-do="addMapping">+ Mapping</button>'}<button class="btn sm" id="veFill">Fill from the table</button></span></h4>
        ${items(e, 'mapping').map(([x, i]) => `<div class="ve-grid2"><label>Table</label><span>${inp(`${E}.items.${i}.table`, x.table, 'class="mono"')} ${chk(`${E}.items.${i}.corresponding`, x.corresponding, 'corresponding')}</span></div><table class="ve-tab"><tr><th>Element</th><th>Column</th><th></th></tr>${x.pairs.map((p, j) => `<tr><td>${inp(`${E}.items.${i}.pairs.${j}.0`, p[0], 'class="mono"')}</td><td>${inp(`${E}.items.${i}.pairs.${j}.1`, p[1], 'class="mono"')}</td>${rowBtns(`${E}.items.${i}.pairs`, j)}</tr>`).join('')}</table>`).join('')}</div>`}
      ${items(e, 'raw').length ? `<div class="ve-sec"><h4>Kept as written <small>(edit in Source)</small></h4>${items(e, 'raw').map(([x]) => `<pre class="ve-raw">${esc(x.text)}</pre>`).join('')}</div>` : ''}`}`;
    body.querySelectorAll('[data-do="op"]').forEach(c => { c.removeAttribute('data-do'); c.onchange = () => act('op', { op: c.dataset.op }); });
    body.querySelectorAll('[data-fields]').forEach(x => x.oninput = () => change(m => { m.entities[V.ent].items[Number(x.dataset.fields)].fields = x.value.split(',').map(s => s.trim()).filter(Boolean); }, true));
    body.querySelectorAll('[data-trig]').forEach(x => x.onchange = () => change(m => { const [i, o] = x.dataset.trig.split('|'); const it = m.entities[V.ent].items[Number(i)]; it.ops = x.checked ? [...new Set([...it.ops, o])] : it.ops.filter(z => z !== o); }));
    body.querySelectorAll('[data-tf]').forEach(x => x.oninput = () => change(m => { m.entities[V.ent].items[Number(x.dataset.tf)].fields = x.value.split(',').map(s => s.trim()).filter(Boolean); }, true));
    const fill = body.querySelector('#veFill'); if (fill) fill.onclick = fillMapping;
  }

  // ---------------------------------------------------------------- metadata extension (Fiori annotations)
  const first = (e, p) => (Array.isArray(e.anns[p]) ? e.anns[p].find(x => !x.type) : null);
  function setFirst(e, p, k, v) {
    let arr = Array.isArray(e.anns[p]) ? e.anns[p] : [];
    let x = arr.find(y => !y.type);
    if (v === '' || v === null || v === false) { if (x) { delete x[k]; if (!Object.keys(x).length || (k === 'position' && !x.position)) arr = arr.filter(y => y !== x); } }
    else { if (!x) { x = {}; arr.unshift(x); } x[k] = v; }
    if (arr.length) e.anns[p] = arr; else delete e.anns[p];
  }
  function ddlxAct(a, d) {
    change(m => {
      if (a === 'addElement') m.elements.push({ name: 'NewElement', anns: { 'UI.lineItem': [{ position: (m.elements.length + 1) * 10 }] } });
      if (a === 'addFacet') { const host = m.elements[0]; const f = host.anns['UI.facet'] || []; f.push({ id: `Section${f.length + 1}`, purpose: { $e: 'STANDARD' }, type: { $e: 'IDENTIFICATION_REFERENCE' }, label: 'Section', position: (f.length + 1) * 10 }); host.anns['UI.facet'] = f; }
      if (a === 'addAction') { const e = m.elements[Number(d.i ?? 0)]; for (const p of ['UI.lineItem', 'UI.identification']) { const arr = e.anns[p] || []; arr.push({ type: { $e: 'FOR_ACTION' }, dataAction: 'action', label: 'Action' }); e.anns[p] = arr; } }
      if (a === 'facetUp' || a === 'facetDown') { const f = m.elements[0].anns['UI.facet']; const i = Number(d.i), j = a === 'facetUp' ? i - 1 : i + 1; if (j < 0 || j >= f.length) return false; [f[i], f[j]] = [f[j], f[i]]; f.forEach((x, k) => { x.position = (k + 1) * 10; }); }
      if (a === 'facetDel') m.elements[0].anns['UI.facet'].splice(Number(d.i), 1);
    });
  }
  // the mini preview: list report columns and object page sections
  function ddlxPreview(d) {
    const hi = d.header['UI.headerInfo'] || {};
    const facets = d.elements[0]?.anns['UI.facet'] || [];
    const actions = [];
    d.elements.forEach((e, i) => (e.anns['UI.lineItem'] || []).forEach((x, j) => { if (x.type?.$e === 'FOR_ACTION') actions.push([i, j, x]); }));
    const cols = d.elements.filter(e => first(e, 'UI.lineItem')?.position && !e.anns['UI.hidden']).sort((a, b) => first(a, 'UI.lineItem').position - first(b, 'UI.lineItem').position);
    const ident = d.elements.filter(e => first(e, 'UI.identification')?.position).sort((a, b) => first(a, 'UI.identification').position - first(b, 'UI.identification').position);
    return `<h4>Preview</h4><div class="ve-pv"><div class="ve-pvh">${esc(hi.typeNamePlural || d.entity)}</div><table><tr>${cols.map(e => `<th>${esc(e.anns['EndUserText.label'] || e.name)}</th>`).join('')}${actions.length ? `<th class="ve-pva">${actions.map(([, , x]) => esc(x.label || x.dataAction)).join(' · ')}</th>` : ''}</tr><tr>${cols.map(() => '<td>…</td>').join('')}</tr></table></div>
        <div class="ve-pv"><div class="ve-pvh">${esc(hi.typeName || d.entity)}: ${esc(hi.title?.value || '')}</div>${facets.filter(f => !f.parentId).sort((a, b) => (a.position || 0) - (b.position || 0)).map(f => `<div class="ve-pvs"><b>${esc(f.label || f.id)}</b>${f.type?.$e === 'IDENTIFICATION_REFERENCE' ? `<div>${ident.map(e => esc(e.anns['EndUserText.label'] || e.name)).join(' · ')}</div>` : f.type?.$e === 'COLLECTION' ? `<div>${facets.filter(c => c.parentId === f.id).map(c => esc(c.label || c.id)).join(' · ')}</div>` : f.type?.$e === 'LINEITEM_REFERENCE' ? `<div>table ${esc(f.targetElement || '')}</div>` : `<div>${d.elements.filter(e => (e.anns['UI.fieldGroup'] || []).some(g => g.qualifier === f.targetQualifier)).map(e => esc(e.anns['EndUserText.label'] || e.name)).join(' · ')}</div>`}</div>`).join('')}</div>`;
  }
  function drawDdlx() {
    const d = V.model;
    const hi = d.header['UI.headerInfo'] || {};
    const facets = d.elements[0]?.anns['UI.facet'] || [];
    const actions = [];
    d.elements.forEach((e, i) => (e.anns['UI.lineItem'] || []).forEach((x, j) => { if (x.type?.$e === 'FOR_ACTION') actions.push([i, j, x]); }));
    body.innerHTML = `<div class="ve-cols"><div class="ve-main">
      <div class="ve-sec"><h4>Header (object page title)</h4><div class="ve-grid2"><label>Entity</label><b>${esc(d.entity)}</b>
        <label>Type name</label><input data-hi="typeName" value="${esc(hi.typeName ?? '')}"><label>Plural</label><input data-hi="typeNamePlural" value="${esc(hi.typeNamePlural ?? '')}">
        <label>Title field</label><input data-hi="title" value="${esc(hi.title?.value ?? '')}" class="mono"><label>Description field</label><input data-hi="description" value="${esc(hi.description?.value ?? '')}" class="mono"></div></div>
      <div class="ve-sec"><h4>Fields <span class="ve-btns"><button class="btn sm" data-do="addElement">+ Element</button></span></h4>
      <table class="ve-tab"><tr><th>Element</th><th>Label</th><th>Hidden</th><th>List column</th><th>Importance</th><th>Filter</th><th>Object page</th><th>Field group</th><th>Criticality</th><th></th></tr>
      ${d.elements.map((e, i) => { const li = first(e, 'UI.lineItem') || {}, fg = (e.anns['UI.fieldGroup'] || [])[0] || {}; return `<tr><td>${inp(`elements.${i}.name`, e.name, 'class="mono"')}</td>
        <td><input data-a="${i}|label" value="${esc(e.anns['EndUserText.label'] ?? '')}"></td><td><input type="checkbox" data-a="${i}|hidden"${e.anns['UI.hidden'] ? ' checked' : ''}></td>
        <td><input type="number" class="w5" data-a="${i}|list" value="${li.position ?? ''}" placeholder="—"></td><td><select data-a="${i}|imp">${['', 'HIGH', 'MEDIUM', 'LOW'].map(x => `<option${li.importance?.$e === x ? ' selected' : ''}>${x}</option>`).join('')}</select></td>
        <td><input type="number" class="w5" data-a="${i}|sel" value="${first(e, 'UI.selectionField')?.position ?? ''}" placeholder="—"></td><td><input type="number" class="w5" data-a="${i}|ident" value="${first(e, 'UI.identification')?.position ?? ''}" placeholder="—"></td>
        <td><input class="w8" data-a="${i}|fgq" value="${esc(fg.qualifier ?? '')}" placeholder="qualifier"><input type="number" class="w4" data-a="${i}|fgp" value="${fg.position ?? ''}"></td>
        <td><input class="w10 mono" data-a="${i}|crit" value="${esc(li.criticality ?? '')}" placeholder="field"></td>${rowBtns('elements', i)}</tr>`; }).join('')}</table></div>
      <div class="ve-sec"><h4>Action buttons <span class="ve-btns"><button class="btn sm" data-do="addAction" data-i="0">+ Action</button></span></h4><table class="ve-tab"><tr><th>Action</th><th>Label</th><th>On element</th></tr>
        ${actions.map(([i, j, x]) => `<tr><td><input class="mono" data-act="${i}|${j}|dataAction" value="${esc(x.dataAction)}"></td><td><input data-act="${i}|${j}|label" value="${esc(x.label ?? '')}"></td><td>${esc(d.elements[i].name)}</td></tr>`).join('') || '<tr><td colspan="3" class="ve-note">No action buttons</td></tr>'}</table></div>
      <div class="ve-sec"><h4>Object page sections (facets) <span class="ve-btns"><button class="btn sm" data-do="addFacet">+ Section</button></span></h4><table class="ve-tab"><tr><th>Id</th><th>Type</th><th>Label</th><th>Parent</th><th>Field group / child</th><th></th></tr>
        ${facets.map((f, k) => `<tr draggable="true" data-fk="${k}"><td><input class="mono w8" data-fc="${k}|id" value="${esc(f.id ?? '')}"></td><td><select data-fc="${k}|type">${['COLLECTION', 'IDENTIFICATION_REFERENCE', 'FIELDGROUP_REFERENCE', 'LINEITEM_REFERENCE'].map(x => `<option${f.type?.$e === x ? ' selected' : ''}>${x}</option>`).join('')}</select></td><td><input data-fc="${k}|label" value="${esc(f.label ?? '')}"></td><td><input class="w8 mono" data-fc="${k}|parentId" value="${esc(f.parentId ?? '')}"></td><td><input class="w10 mono" data-fc="${k}|${f.type?.$e === 'LINEITEM_REFERENCE' ? 'targetElement' : 'targetQualifier'}" value="${esc(f.targetElement ?? f.targetQualifier ?? '')}"></td><td class="ve-ops"><button class="x" data-do="facetUp" data-i="${k}">↑</button><button class="x" data-do="facetDown" data-i="${k}">↓</button><button class="x" data-do="facetDel" data-i="${k}">✕</button></td></tr>`).join('')}</table><p class="ve-note">Drag rows (or ↑ ↓) to order the sections.</p></div></div>
      <div class="ve-side">${ddlxPreview(d)}</div></div>`;
    body.querySelectorAll('[data-hi]').forEach(x => x.oninput = () => change(m => { const h = m.header['UI.headerInfo'] ||= {}; const k = x.dataset.hi; if (k === 'title') h.title = { ...(h.title || { type: { $e: 'STANDARD' } }), value: x.value }; else if (k === 'description') h.description = { value: x.value }; else h[k] = x.value; }, true));
    body.querySelectorAll('[data-a]').forEach(x => { const ev = x.type === 'checkbox' || x.tagName === 'SELECT' ? 'onchange' : 'oninput'; x[ev] = () => change(m => {
      const [i, k] = x.dataset.a.split('|'); const e = m.elements[Number(i)]; const n = x.value === '' ? '' : Number(x.value);
      if (k === 'label') { if (x.value) e.anns['EndUserText.label'] = x.value; else delete e.anns['EndUserText.label']; }
      if (k === 'hidden') { if (x.checked) e.anns['UI.hidden'] = true; else delete e.anns['UI.hidden']; }
      if (k === 'list') setFirst(e, 'UI.lineItem', 'position', n);
      if (k === 'imp') setFirst(e, 'UI.lineItem', 'importance', x.value ? { $e: x.value } : '');
      if (k === 'crit') setFirst(e, 'UI.lineItem', 'criticality', x.value);
      if (k === 'sel') setFirst(e, 'UI.selectionField', 'position', n);
      if (k === 'ident') setFirst(e, 'UI.identification', 'position', n);
      if (k === 'fgq' || k === 'fgp') { const g = (e.anns['UI.fieldGroup'] || [{}])[0]; if (k === 'fgq') g.qualifier = x.value; else g.position = n; if (!g.qualifier) delete e.anns['UI.fieldGroup']; else e.anns['UI.fieldGroup'] = [g, ...(e.anns['UI.fieldGroup'] || []).slice(1)]; }
    }, ev === 'oninput'); });
    body.querySelectorAll('[data-act]').forEach(x => x.oninput = () => change(m => { const [i, j, k] = x.dataset.act.split('|'); const e = m.elements[Number(i)]; const old = e.anns['UI.lineItem'][Number(j)][k]; e.anns['UI.lineItem'][Number(j)][k] = x.value; (e.anns['UI.identification'] || []).forEach(y => { if (y.type?.$e === 'FOR_ACTION' && y[k] === old) y[k] = x.value; }); }, true));
    body.querySelectorAll('[data-fc]').forEach(x => { const ev = x.tagName === 'SELECT' ? 'onchange' : 'oninput'; x[ev] = () => change(m => { const [k, p] = x.dataset.fc.split('|'); const f = m.elements[0].anns['UI.facet'][Number(k)]; if (p === 'type') f.type = { $e: x.value }; else if (x.value) f[p] = x.value; else delete f[p]; }, ev === 'oninput'); });
    // drag a section row onto another to move it there
    let dragK = null;
    body.querySelectorAll('[data-fk]').forEach(r => { r.ondragstart = () => { dragK = Number(r.dataset.fk); }; r.ondragover = ev => ev.preventDefault(); r.ondrop = ev => { ev.preventDefault(); const to = Number(r.dataset.fk); if (dragK === null || dragK === to) return; change(m => { const f = m.elements[0].anns['UI.facet']; const [x] = f.splice(dragK, 1); f.splice(to, 0, x); f.forEach((y, k) => { y.position = (k + 1) * 10; }); }); }; });
  }

  // ---------------------------------------------------------------- programs: screens, GUI status, text elements
  const CW = 9, RH = 22;
  const progName = () => (V.model?.screens.program || file.split('/').pop().split('.')[0]).toLowerCase();
  const srcFile = () => `src/${progName()}.prog.abap`;
  const getSrc = async () => (V.src ??= await fetch(`/a/${app}/api/source/${encodeURIComponent(srcFile())}`).then(r => (r.ok ? r.text() : '')).catch(() => ''));
  const putSrc = async text => { await api('PUT', `/a/${app}/api/source/${encodeURIComponent(srcFile())}`, text, true); V.src = text; };
  const elLabel = f => (f.type === 'TEXT' ? f.text : f.type === 'CHECK' ? `☐ ${f.text || f.name}` : f.type === 'RADIO' ? `○ ${f.text || f.name}` : f.type === 'PUSH' ? f.text || f.name : f.type === 'FRAME' ? f.text || f.name : f.dropdown ? `${f.name} ▾` : f.name);
  async function loadFlow() {
    const s = V.model?.screens.screens[V.screen];
    V.flow = null;
    if (!s) return draw();
    const f = `src/${progName()}.prog.screen_${s.screen}.abap`;
    const t = await fetch(`/a/${app}/api/source/${encodeURIComponent(f)}`).then(r => (r.ok ? r.text() : '')).catch(() => '');
    V.flow = { file: f, text: t || `PROCESS BEFORE OUTPUT.\n  MODULE status_${s.screen}.\n\nPROCESS AFTER INPUT.\n  MODULE user_command_${s.screen}.\n`, exists: !!t, dirty: !t };
    getSrc().then(() => draw());
  }
  async function saveFlow(quiet) {
    await api('PUT', `/a/${app}/api/source/${encodeURIComponent(V.flow.file)}`, V.flow.text, true);
    V.flow.exists = true; V.flow.dirty = false;
    if (!quiet) { $('.ve-msg').className = 've-msg'; $('.ve-msg').textContent = `Flow logic saved (${V.flow.file.replace(/^src\//, '')})`; }
    draw();
  }
  // modules the flow logic calls that the program does not have: appended as stubs
  async function createModules() {
    const src = await getSrc();
    const miss = C.missingModules(V.flow.text, src);
    if (!miss.length) { msgText('Every module of the flow logic exists in the program'); return; }
    await putSrc(`${src.replace(/\s*$/, '\n')}${miss.map(C.moduleStub).join('')}`);
    $('.ve-msg').className = 've-msg'; $('.ve-msg').textContent = `Added ${miss.map(m => `MODULE ${m.name}`).join(', ')} to ${srcFile().replace(/^src\//, '')}`;
    draw();
  }
  // the lines the elements and containers of a screen cover (frames and containers cover several)
  const usedLines = s => {
    const used = new Set();
    for (const f of s.fields) if (f.contType === 'SCREEN' && f.type !== 'OKCODE' && f.type !== 'FRAME') used.add(f.line);
    for (const c of s.containers || []) if (c.type !== 'SCREEN' && c.elementOf === 'SCREEN') for (let l = c.line; l < c.line + Math.max(1, c.height); l++) used.add(l);
    return used;
  };
  // the first free line of the screen (n lines in a row); the screen grows when it is full
  const freeLine = (s, n = 1) => {
    const used = usedLines(s);
    for (let l = 1; l + n - 1 <= s.lines; l++) { let ok = true; for (let k = 0; k < n; k++) if (used.has(l + k)) ok = false; if (ok) return l; }
    const l = Math.max(0, ...used) + 1;
    s.lines = Math.max(s.lines, l + n - 1);
    return l;
  };
  const newField = (type, s) => {
    const line = freeLine(s, type === 'FRAME' ? 4 : 1);
    const n = s.fields.length + 1;
    const base = { text: '', line, column: 1, length: 14, height: 1, format: 'CHAR', input: false, output: false, required: false, fcode: '', dropdown: '', heading: false, contType: 'SCREEN', contName: 'SCREEN', other: [] };
    if (type === 'TEXT') return { ...base, type, name: `LBL_${n}`, text: 'Label' };
    if (type === 'TEMPLATE') return { ...base, type, name: `GV_FIELD${n}`, column: 16, length: 20, input: true, output: true };
    if (type === 'LISTBOX') return { ...base, type: 'TEMPLATE', name: `GV_LIST${n}`, column: 16, length: 20, input: true, output: true, dropdown: 'L' };
    if (type === 'CHECK') return { ...base, type, name: `GV_FLAG${n}`, text: 'Option', length: 20, input: true, output: true };
    if (type === 'RADIO') return { ...base, type, name: `GV_RADIO${n}`, text: 'Choice', length: 20, input: true, output: true };
    if (type === 'PUSH') return { ...base, type, name: `BTN_${n}`, text: 'Button', length: 12, fcode: 'BUTTON' };
    if (type === 'FRAME') return { ...base, type, name: `FRAME_${n}`, text: 'Group', length: 60, height: 4 };
  };
  async function progAct(a, d) {
    const S = V.model.screens.screens[V.screen];
    if (a === 'addScreen') {
      change(m => { const nr = String(Math.max(0, ...m.screens.screens.map(s => Number(s.screen))) + 100).padStart(4, '0'); m.screens.screens.push({ screen: nr, descript: 'Screen', type: d.sub ? 'I' : 'N', next: nr, lines: d.sub ? 10 : 24, columns: 80, containers: [{ type: 'SCREEN', name: 'SCREEN', other: [] }], fields: d.sub ? [] : [{ type: 'OKCODE', name: 'GV_OK_CODE', text: '', line: 0, column: 0, length: 20, height: 1, format: 'CHAR', input: true, output: false, contType: 'SCREEN', contName: 'SCREEN', other: [] }] }); });
      V.screen = V.model.screens.screens.length - 1; V.sel = -1; V.selC = -1;
      return loadFlow();
    }
    if (a === 'addEl') { change(m => { const s = m.screens.screens[V.screen]; s.fields.push(newField(d.t, s)); }); V.sel = V.model.screens.screens[V.screen].fields.length - 1; V.selC = -1; return draw(); }
    if (a === 'addOk') { change(m => { const s = m.screens.screens[V.screen]; if (!s.fields.some(f => f.type === 'OKCODE')) s.fields.push({ type: 'OKCODE', name: 'GV_OK_CODE', text: '', line: 0, column: 0, length: 20, height: 1, format: 'CHAR', input: true, output: false, contType: 'SCREEN', contName: 'SCREEN', other: [] }); }); return; }
    if (a === 'addSub') {
      change(m => { const s = m.screens.screens[V.screen]; const line = Math.max(1, ...s.fields.filter(f => f.contType === 'SCREEN').map(f => f.line)) + 1; s.containers.push({ type: 'SUBSCREEN', name: `SUB_AREA${s.containers.length}`, elementOf: 'SCREEN', line, column: 1, length: 78, height: 6, other: [] }); });
      V.selC = V.model.screens.screens[V.screen].containers.length - 1; V.sel = -1;
      if (V.flow) { V.flow.text = C.addToFlow(C.addToFlow(V.flow.text, 'pbo', `  CALL SUBSCREEN sub_area${S.containers.length - 1} INCLUDING sy-repid '0200'.`), 'pai', `  CALL SUBSCREEN sub_area${S.containers.length - 1}.`); V.flow.dirty = true; }
      return draw();
    }
    if (a === 'tcWizard') { V.wizard = { name: `TC_${String(Date.now() % 100)}`.replace(/_\d+$/, '_ITEMS'), table: 'GT_ITEMS', wa: 'GS_ITEM', lineType: '', height: 8 }; V.sel = -1; V.selC = -1; return draw(); }
    if (a === 'tcCols') { const lt = V.wizard.lineType.trim().toLowerCase(); const cols = lt ? await componentsOf(lt) : null; if (!cols?.length) { msgText(`${lt.toUpperCase() || 'The line type'}: not a structure or table of this app`); return; } Object.assign(V.wizard, { cols, colsOf: lt }); return draw(); }
    if (a === 'tcCancel') { V.wizard = null; V.tsWizard = null; V.picker = null; return draw(); }
    if (a === 'picker') { V.picker = { source: '', labels: true, input: true, declare: true }; V.wizard = null; V.tsWizard = null; V.sel = -1; V.selC = -1; getSrc().then(() => draw()); return draw(); }
    if (a === 'pickLoad') return pickerLoad();
    if (a === 'pickPlace') return pickerPlace();
    if (a === 'tsWizard') { const used = V.model.screens.screens.map(x => Number(x.screen)); let n = Number(S?.screen || 100) + 10; while (used.includes(n)) n += 10; V.tsWizard = { name: 'TS_MAIN', tabs: 'Header, Items', first: String(n).padStart(4, '0'), height: 8 }; V.wizard = null; V.sel = -1; V.selC = -1; return draw(); }
    if (a === 'tsCreate') return createTabstrip();
    if (a === 'tsAddTab') return addTab();
    if (a === 'tcCreate') return createTableControl();
    if (a === 'selF') { V.sel = Number(d.i); V.selC = -1; V.wizard = null; V.tsWizard = null; return draw(); }
    if (a === 'selC') { V.selC = Number(d.i); V.sel = -1; V.wizard = null; return draw(); }
    if (a === 'delC') { const c = S.containers[V.selC]; change(m => { const s = m.screens.screens[V.screen]; s.containers = s.containers.filter((x, k) => k !== V.selC && x.elementOf !== c.name); s.fields = s.fields.filter(f => !(f.contType === c.type && f.contName === c.name)); }); V.selC = -1; return draw(); }
    if (a === 'tcAddCol') { const c = S.containers[V.selC]; change(m => { const s = m.screens.screens[V.screen]; const n = s.fields.filter(f => f.contName === c.name && f.type !== 'TEXT').length + 1; const wa = (s.fields.find(f => f.contName === c.name && f.type !== 'TEXT')?.name || 'GS_ROW-X').split('-')[0]; const r = C.tableControl({ name: c.name, wa, columns: [{ name: `FIELD${n}`, length: 10 }] }); r.fields.forEach(f => { f.column = n; }); s.fields.push(...r.fields); }); return draw(); }
    if (a === 'tcDelCol') { const c = S.containers[V.selC]; change(m => { const s = m.screens.screens[V.screen]; const col = Number(d.col); s.fields = s.fields.filter(f => !(f.contName === c.name && f.column === col)); s.fields.filter(f => f.contName === c.name && f.column > col).forEach(f => { f.column -= 1; }); }); return draw(); }
    if (a === 'flowSave') return saveFlow();
    if (a === 'flowTpl') {
      const t = C.FLOW_TEMPLATES.find(x => x[0] === d.t);
      const sc = V.model.screens.screens[V.screen];
      const fld = sc?.fields.find(f => f.type === 'TEMPLATE' && f.input && f.contType === 'SCREEN')?.name.toLowerCase() || 'gv_field';
      const snippet = t[3]('').replace(/gv_field1, gv_field2/g, sc?.fields.filter(f => f.type === 'TEMPLATE' && f.input && f.contType === 'SCREEN').slice(0, 2).map(f => f.name.toLowerCase()).join(', ') || 'gv_field1, gv_field2').replace(/gv_field/g, fld);
      V.flow.text = V.flowCaret != null ? C.insertAtLine(V.flow.text, V.flowCaret, snippet) : C.addToFlow(V.flow.text, t[2], snippet, t[2] === 'pai' ? 'start' : 'end');
      V.flow.dirty = true; return draw();
    }
    if (a === 'flowModules') return createModules();
    // GUI status
    const st = () => V.model.cua.statuses[V.status || 0];
    if (a === 'addStatus') { change(m => { m.cua.statuses.push(statusTemplate(d.code || `STATUS${m.cua.statuses.length + 1}`, m.cua)); }); V.status = V.model.cua.statuses.length - 1; return draw(); }
    if (a === 'stTab') { V.status = Number(d.i); return draw(); }
    if (a === 'addFun') { change(m => { let n = 1; while (m.cua.functions.some(f => f.code === `FUNC${n}`)) n++; m.cua.functions.push({ code: `FUNC${n}`, text: 'Function', icon: '', iconText: '', exit: false }); }); return; }
    if (a === 'addBtn') { change(m => { const s = m.cua.statuses[V.status || 0]; const f = m.cua.functions.find(x => !s.toolbar.includes(x.code) && !x.exit); if (!f) return false; s.toolbar.push(f.code); }); return; }
    if (a === 'addSep') { change(m => { m.cua.statuses[V.status || 0].toolbar.push('-'); }); return; }
    if (a === 'addMenu') { change(m => { m.cua.menus.push({ code: String(m.cua.menus.length + 1).padStart(6, '0'), text: 'Edit', items: m.cua.functions.filter(f => !f.exit).map(f => f.code).slice(0, 3) }); }); return; }
    if (a === 'addTitle') { change(m => { m.cua.titles.push({ code: d.code || `TITLE${m.cua.titles.length + 1}`, text: V.model.screens.screens[0]?.descript || 'Title' }); }); return; }
    // text elements
    if (a === 'addSym') { change(m => { const used = new Set(m.tpool.symbols.map(x => x.key)); let n = 1; while (used.has(String(n).padStart(3, '0'))) n++; m.tpool.symbols.push({ key: d.key || String(n).padStart(3, '0'), text: '', length: 40 }); }); return; }
    if (a === 'addHead') { change(m => { m.tpool.headings.push({ key: String(m.tpool.headings.length + 1).padStart(3, '0'), text: '' }); }); return; }
    if (a === 'ddicText') return ddicText(d.key);
    void st;
  }
  function statusTemplate(code, cua) {
    for (const [c, t, e, icon] of [['BACK', 'Back', true], ['EXIT', 'Exit', true], ['CANCEL', 'Cancel', true], ['SAVE', 'Save', false, 'ICON_SYSTEM_SAVE']]) if (!cua.functions.some(f => f.code === c)) cua.functions.push({ code: c, text: t, icon: icon || '', iconText: icon ? t : '', exit: e });
    return { code: code.toUpperCase(), text: code, modal: 'D', keys: { '03': 'BACK', 15: 'EXIT', 12: 'CANCEL', 11: 'SAVE' }, toolbar: ['SAVE'], assigned: [] };
  }
  // the label of a selection parameter from its data element (PARAMETERS p TYPE zdtel / FOR tab-field)
  async function ddicText(key) {
    const r = await ddicLabel(key);
    if (r.error && !r.copy) { msgText(r.error); return; }
    const label = r.label || r.copy;
    if (!label) { msgText(`${key}: the data element has no label`); return; }
    change(m => { const x = m.tpool.selections.find(s => s.key === key); x.text = label.slice(0, 30); x.ddic = false; });
  }
  // the data element label of a selection parameter: { label } or { error }
  async function ddicLabel(key) {
    const t = C.selectionType(await getSrc(), key);
    if (!t) return { error: `${key} has no data element to take the text from (TYPE <data element> or FOR <table>-<field>)`, noDtel: true };
    let dtel = t;
    if (/^(c|n|i|p|d|t|f|x|string|xstring|int8|decfloat16|decfloat34|utclong)$/.test(t)) return { error: `${key} is typed with the built-in type ${t.toUpperCase()}: it has no data element, so there is no dictionary reference to take the text from. Type the text instead.`, noDtel: true };
    if (t.includes('-')) {
      const [tab, fld] = t.split('-');
      const tx = await fetch(`/a/${app}/api/source/${encodeURIComponent(`src/${tab}.tabl.cds`)}`).then(r => (r.ok ? r.text() : '')).catch(() => '');
      let def = null; try { def = tx ? M.parseTable(tx) : null; } catch {}
      const f = def?.fields.find(x => x.name === fld);
      dtel = f && !f.builtin ? f.type : null;
      // a field with a built-in type has no data element: no dictionary reference (its label can be copied once)
      if (!dtel) return { error: `${t.toUpperCase()} is typed with a built-in type${f ? ` (${f.type}${f.length ? `(${f.length})` : ''})` : ''}: it has no data element, so there is no dictionary reference to take the text from. Type the text instead, or give the field a data element.`, noDtel: true, ...(f?.anns['EndUserText.label'] ? { copy: f.anns['EndUserText.label'] } : {}) };
    }
    const x = await fetch(`/a/${app}/api/source/${encodeURIComponent(`src/${dtel}.dtel.xml`)}`).then(r => (r.ok ? r.text() : '')).catch(() => '');
    const d = x ? C.parseDtelXml(x) : null;
    if (!d) return { error: `Data element ${dtel.toUpperCase()} is not in this app`, noDtel: !/^[zy]/i.test(dtel) ? false : true };
    // the medium label, like the selection screen with a dictionary reference
    return { label: d.medium || d.long || d.text };
  }
  // the components of a structure / table of the app (with its includes) with what a screen field needs: the data
  // element's label, the output length and the format (DDIC types of the data element / domain)
  const dtelCache = new Map();
  const src_ = f => fetch(`/a/${app}/api/source/${encodeURIComponent(f)}`).then(r => (r.ok ? r.text() : '')).catch(() => '');
  async function dtelInfo(n) {
    n = String(n).toLowerCase();
    if (!dtelCache.has(n)) dtelCache.set(n, (async () => {
      const x = await src_(`src/${n}.dtel.xml`);
      if (!x) return null;
      const d = C.parseDtelXml(x);
      let dt = d.datatype, len = d.length, dec = d.decimals;
      if (d.domain) { const dx = await src_(`src/${d.domain.toLowerCase()}.doma.xml`); if (dx) { const dm = C.parseDomaXml(dx); dt = dm.datatype; len = dm.length; dec = dm.decimals; } }
      return { label: d.medium || d.long || d.short || d.text, heading: d.heading || d.medium, datatype: dt, length: len, decimals: dec };
    })());
    return dtelCache.get(n);
  }
  const outLen = (dt, len, dec) => (dt === 'DATS' ? 10 : dt === 'TIMS' ? 8 : /^INT/.test(dt) ? 11 : /DEC|CURR|QUAN/.test(dt) ? len + Math.floor(Math.max(0, len - dec - 1) / 3) + (dec ? 1 : 0) + 1 : len || 10);
  const FORMATS = { CHAR: 'CHAR', NUMC: 'NUMC', DEC: 'DEC', CURR: 'CURR', QUAN: 'QUAN', DATS: 'DATS', TIMS: 'TIMS', INT4: 'INT4', INT1: 'INT4', INT2: 'INT4', CUKY: 'CUKY', UNIT: 'UNIT' };
  async function componentsOf(type, depth = 0) {
    const tx = await src_(`src/${String(type).toLowerCase()}.tabl.cds`);
    if (!tx) return null;
    let def; try { def = M.parseTable(tx); } catch { return null; }
    const out = [];
    for (const f of def.fields) {
      if (f.raw) continue;
      if (f.include) { if (depth < 3) out.push(...((await componentsOf(f.include, depth + 1)) || [])); continue; }
      if (f.type === 'clnt') continue;
      let dt = f.builtin ? f.type.toUpperCase().replace('STRING', 'STRG') : 'CHAR', len = f.length || 0, dec = f.decimals || 0, label = f.anns['EndUserText.label'] || '';
      if (!f.builtin) { const d = await dtelInfo(f.type); if (d) { dt = d.datatype; len = d.length; dec = d.decimals; label ||= d.label; } else len = 20; }
      if (f.builtin && !len) len = { DATS: 8, TIMS: 6, CUKY: 5, UNIT: 3, INT4: 10, LANG: 1 }[dt] || 20;
      // noLabel: neither a data element label nor @EndUserText.label (a built-in type): the picker and the table
      // control wizard offer to add one (owner: the table / structure source the field is defined in)
      out.push({ name: f.name.toUpperCase(), label: label || f.name.replace(/_/g, ' ').toUpperCase(), noLabel: !label, owner: String(type).toLowerCase(), field: f.name, length: outLen(dt, len, dec), format: FORMATS[dt] || 'CHAR', datatype: dt });
    }
    return out;
  }
  // labels typed for fields without one: saved as @EndUserText.label in the table / structure source, used right away
  const labelInputs = (comps, attr) => {
    const miss = comps.map((c, i) => [c, i]).filter(([c]) => c.noLabel);
    if (!miss.length) return '';
    return `<div class="ve-labels"><p class="ve-note">${miss.length} field(s) have no label (a built-in type without @EndUserText.label): their technical name would show. Type a label to add it to the dictionary.</p>
      <table class="ve-tab ve-small"><tr><th>Field</th><th>Label (@EndUserText.label)</th></tr>${miss.map(([c, i]) => `<tr><td class="mono">${esc(c.name)}</td><td><input class="w12" ${attr}="${i}" value="${esc(c.newLabel || '')}" maxlength="60" placeholder="${esc(c.name)}" aria-label="Label of ${esc(c.name)}"></td></tr>`).join('')}</table></div>`;
  };
  async function saveLabels(comps) {
    const byOwner = new Map();
    for (const c of comps) if (c.noLabel && c.newLabel?.trim()) { (byOwner.get(c.owner) || byOwner.set(c.owner, {}).get(c.owner))[c.field] = c.newLabel.trim(); c.label = c.newLabel.trim().slice(0, 60); c.noLabel = false; }
    const saved = [];
    for (const [owner, labels] of byOwner) {
      const f = `src/${owner}.tabl.cds`;
      const tx = await src_(f);
      if (!tx) continue;
      const next = M.addFieldLabels(tx, labels);
      if (next !== tx) { await api('PUT', `/a/${app}/api/source/${encodeURIComponent(f)}`, next, true); saved.push(owner.toUpperCase()); }
    }
    return saved;
  }
  // what a program variable is typed with: DATA gs_head TYPE zpo_s_header. / TABLES zpo_head.
  async function variableType(name) {
    const src = await getSrc();
    const n = String(name).toLowerCase();
    const m = new RegExp(`\\b(?:DATA|CLASS-DATA|STATICS)\\s*:?\\s+${n}\\s+TYPE\\s+([\\w/]+)\\s*\\.`, 'i').exec(src);
    if (m) return m[1].toLowerCase();
    if (new RegExp(`\\bTABLES\\s*:?\\s+${n}\\b`, 'i').test(src)) return n;
    return null;
  }
  const programVariables = src => [...new Set([...String(src || '').matchAll(/\b(?:DATA|TABLES)\s*:?\s+(\w+)/gi)].map(m => m[1].toUpperCase()))];
  async function pickerLoad() {
    const p = V.picker, q = p.source.trim().toLowerCase();
    if (!q) return;
    let type = q, variable = null;
    if (!(await src_(`src/${q}.tabl.cds`))) { type = await variableType(q); variable = q; }
    const comps = type ? await componentsOf(type) : null;
    if (!comps) { msgText(`${q.toUpperCase()}: not a structure or table of this app, nor a program variable typed with one`); return; }
    Object.assign(p, { type, variable, comps, chosen: comps.map(c => !/^(client|mandt)$/i.test(c.name)), prefix: (variable || p.prefix || type).toUpperCase() });
    draw();
  }
  async function pickerPlace() {
    const p = V.picker;
    const chosen = p.comps.filter((c, i) => p.chosen[i]);
    if (!chosen.length) { msgText('Tick the fields to place'); return; }
    const s0 = V.model.screens.screens[V.screen];
    const savedLabels = await saveLabels(p.comps);
    const labelW = Math.min(20, Math.max(...chosen.map(c => c.label.length)) + 1);
    change(m => {
      const s = m.screens.screens[V.screen];
      const start = freeLine(s, chosen.length);
      chosen.forEach((c, k) => {
        const line = start + k;
        if (line > s.lines) s.lines = line;
        if (p.labels) s.fields.push({ type: 'TEXT', name: `LBL_${c.name}`.slice(0, 30), text: c.label.slice(0, labelW), line, column: 1, length: Math.max(1, Math.min(labelW, c.label.length)), height: 1, format: 'CHAR', contType: 'SCREEN', contName: 'SCREEN', other: [] });
        s.fields.push({ type: 'TEMPLATE', name: `${p.prefix}-${c.name}`, text: '', line, column: p.labels ? labelW + 2 : 1, length: Math.min(60, c.length), height: 1, format: c.format, input: !!p.input, output: true, required: false, fcode: '', dropdown: '', contType: 'SCREEN', contName: 'SCREEN', other: [] });
      });
    });
    // the screen fields need a global variable of that name
    if (p.declare) {
      const src = await getSrc();
      const v = p.prefix.toLowerCase();
      if (!new RegExp(`\\b(DATA|TABLES)\\s*:?\\s+${v}\\b`, 'i').test(src)) {
        const decl = v === p.type ? `TABLES ${v}.\n` : `DATA ${v} TYPE ${p.type}.\n`;
        await putSrc(C.insertDeclarations(src, decl));
      }
    }
    $('.ve-msg').className = 've-msg'; $('.ve-msg').textContent = `${chosen.length} field(s) of ${p.type.toUpperCase()} placed as ${p.prefix}-…${savedLabels.length ? `; labels added to ${savedLabels.join(', ')}` : ''}`;
    V.picker = null; void s0;
    draw();
  }
  function pickerHtml() {
    const p = V.picker;
    return `<h4>Fields from the dictionary / program</h4><div class="ve-grid2"><label>From</label><span><input class="mono w12" data-pk="source" list="vePickSrc" value="${esc(p.source)}" placeholder="ZPO_HEAD or GS_HEAD"> <button class="btn sm" data-do="pickLoad">Show fields</button></span></div>
      <datalist id="vePickSrc">${[...programVariables(V.src), ...V.meta.structures.map(x => String(x).toUpperCase()), ...V.meta.tables.map(x => String(x).toUpperCase())].map(x => `<option value="${esc(x)}">`).join('')}</datalist>
      ${p.comps ? `<div class="ve-grid2"><label>Screen fields</label><input class="mono w12" data-pk="prefix" value="${esc(p.prefix)}" title="The program variable (structure / TABLES work area) the screen fields belong to"></div>
        <div class="ve-pick">${p.comps.map((c, i) => `<label class="ve-chk"><input type="checkbox" data-pc="${i}"${p.chosen[i] ? ' checked' : ''}> <span class="mono">${esc(c.name)}</span> <small>${esc(c.label)} · ${esc(c.format)} ${c.length}</small></label>`).join('')}</div>
        ${labelInputs(p.comps, 'data-plabel')}
        <label class="ve-chk"><input type="checkbox" data-pf="labels"${p.labels ? ' checked' : ''}> with labels</label> <label class="ve-chk"><input type="checkbox" data-pf="input"${p.input ? ' checked' : ''}> ready for input</label>
        ${p.variable ? '' : `<label class="ve-chk"><input type="checkbox" data-pf="declare"${p.declare ? ' checked' : ''}> declare ${esc(p.prefix)} in the program</label>`}
        <p><button class="btn sm primary" data-do="pickPlace">Place fields</button> <button class="btn sm ghost" data-do="tcCancel">Cancel</button></p>`
      : '<p class="ve-note">A structure or table of the app, or a program variable typed with one (DATA gs_head TYPE zpo_head). The fields get the data element\'s label, length and format.</p><p><button class="btn sm ghost" data-do="tcCancel">Cancel</button></p>'}`;
  }
  async function createTableControl() {
    const w = V.wizard;
    const lt = w.lineType.trim().toLowerCase();
    if (!/^\w+$/.test(w.name) || !/^\w+$/.test(w.table) || !/^\w+$/.test(w.wa) || !lt) { msgText('Name the table control, the internal table, the work area and the line type'); return; }
    const cols = w.cols && w.colsOf === lt ? w.cols : await componentsOf(lt);
    if (!cols?.length) { msgText(`${lt.toUpperCase()} is not a structure or table of this app`); return; }
    const savedLabels = await saveLabels(cols);
    const s = V.model.screens.screens[V.screen];
    const line = freeLine(s, Number(w.height) || 8);
    const r = C.tableControl({ name: w.name.toUpperCase(), line, column: 1, width: Math.min(s.columns - 2, 120), height: Number(w.height) || 8, wa: w.wa.toUpperCase(), columns: cols.slice(0, 12) });
    change(m => { const x = m.screens.screens[V.screen]; x.lines = Math.max(x.lines, s.lines); x.containers.push(r.container); x.fields.push(...r.fields); });
    // a table type of the app with this line type: the internal table gets it (methods / FMs take it as a parameter)
    let tableType = null;
    for (const tt of V.meta.tableTypes || []) {
      const x = await src_(`src/${String(tt).toLowerCase()}.ttyp.xml`);
      if (x && C.parseTtypXml(x).rowtype.toLowerCase() === lt) { tableType = String(tt).toLowerCase(); break; }
    }
    const code = C.tableControlCode({ name: w.name, table: w.table, wa: w.wa, lineType: lt, screen: s.screen, tableType });
    // flow logic: the loops; the program: CONTROLS, the internal table, the work area, the module of the PAI loop
    if (V.flow) { V.flow.text = C.addToFlow(C.addToFlow(V.flow.text, 'pbo', code.pbo), 'pai', code.pai, 'start'); await saveFlow(true); }
    const src = await getSrc();
    let next = src;
    next = C.insertDeclarations(next, code.decl);
    if (!new RegExp(`MODULE\\s+modify_${w.name}\\b`, 'i').test(next)) next = `${next.replace(/\s*$/, '\n')}${code.modules}`;
    if (next !== src) await putSrc(next);
    V.wizard = null; V.selC = V.model.screens.screens[V.screen].containers.length - 1;
    $('.ve-msg').className = 've-msg'; $('.ve-msg').textContent = `Table control ${w.name.toUpperCase()} added: ${cols.length} columns, flow logic and ${srcFile().replace(/^src\//, '')} updated${savedLabels.length ? `; labels added to ${savedLabels.join(', ')}` : ''}`;
    draw();
  }
  // tabstrips: the strip with a subscreen area, a tab (push button) and a subscreen per tab; the program gets
  // CONTROLS … TYPE TABSTRIP, the shown subscreen and two modules, the flow logic CALL SUBSCREEN and the tab module
  const freeScreens = (from, n) => { const used = new Set(V.model.screens.screens.map(x => Number(x.screen))); const out = []; for (let k = Number(from) || 110; out.length < n; k += 10) if (!used.has(k)) out.push(String(k).padStart(4, '0')); return out; };
  const okName = () => (V.model.screens.screens[V.screen].fields.find(f => f.type === 'OKCODE')?.name || 'GV_OK_CODE').toLowerCase();
  async function createTabstrip() {
    const w = V.tsWizard;
    const tabs = String(w.tabs).split(',').map(x => x.trim()).filter(Boolean);
    if (!/^\w+$/.test(w.name) || !tabs.length) { msgText('Name the tabstrip and its tabs (comma separated)'); return; }
    const s = V.model.screens.screens[V.screen];
    if (s.containers.some(c => c.name === w.name.toUpperCase())) { msgText(`${w.name.toUpperCase()} exists on this screen`); return; }
    const screens = freeScreens(w.first, tabs.length);
    const line = freeLine(s, Number(w.height) || 8);
    const r = C.tabstrip({ name: w.name, line, column: 1, width: Math.min(s.columns - 2, 78), height: Number(w.height) || 8, tabs, screens });
    change(m => { const x = m.screens.screens[V.screen]; x.lines = Math.max(x.lines, s.lines); x.containers.push(r.container, r.area); x.fields.push(...r.fields); m.screens.screens.push(...r.subscreens); });
    const code = C.tabstripCode({ name: w.name, tabs, screens, okcode: okName() });
    if (V.flow) { V.flow.text = C.addToFlow(C.addToFlow(V.flow.text, 'pbo', code.pbo), 'pai', code.pai, 'start'); await saveFlow(true); }
    for (const n of screens) await api('PUT', `/a/${app}/api/source/${encodeURIComponent(`src/${progName()}.prog.screen_${n}.abap`)}`, 'PROCESS BEFORE OUTPUT.\n\nPROCESS AFTER INPUT.\n', true);
    const src = await getSrc();
    let next = src;
    next = C.insertDeclarations(next, code.decl);
    next = `${next.replace(/\s*$/, '\n')}${code.modules}`;
    await putSrc(next);
    V.tsWizard = null; V.selC = V.model.screens.screens[V.screen].containers.findIndex(c => c.name === w.name.toUpperCase());
    $('.ve-msg').className = 've-msg'; $('.ve-msg').textContent = `Tabstrip ${w.name.toUpperCase()} added: ${tabs.length} tabs on subscreens ${screens.join(', ')}; flow logic and ${srcFile().replace(/^src\//, '')} updated`;
    draw();
  }
  async function addTab() {
    const s = V.model.screens.screens[V.screen], c = s.containers[V.selC];
    const tabs = s.fields.filter(f => f.contType === 'STRIP_CTRL' && f.contName === c.name).sort((x, y) => x.column - y.column);
    const [screen] = freeScreens(Number(s.screen) + 10, 1);
    const text = `Tab ${tabs.length + 1}`;
    const r = C.tabstrip({ name: c.name, line: c.line, column: c.column, width: c.length, height: c.height, tabs: [...tabs.map(t => t.text), text], screens: [...tabs.map(() => '0000'), screen] });
    change(m => { const x = m.screens.screens[V.screen]; x.fields.push(r.fields.at(-1)); m.screens.screens.push(r.subscreens.at(-1)); });
    await api('PUT', `/a/${app}/api/source/${encodeURIComponent(`src/${progName()}.prog.screen_${screen}.abap`)}`, 'PROCESS BEFORE OUTPUT.\n\nPROCESS AFTER INPUT.\n', true);
    // the tab module gets the new function code
    const src = await getSrc();
    const n = c.name.toLowerCase(), dyn = `gv_${n}_dynnr`.slice(0, 30);
    const code = C.tabCode(c.name, tabs.length);
    const next = src.replace(new RegExp(`(MODULE\\s+${n}_tabs\\s+INPUT\\.[\\s\\S]*?)(\\n\\s*ENDCASE\\.)`, 'i'), `$1\n    WHEN '${code}'.\n      ${n}-activetab = '${code}'.\n      ${dyn} = '${screen}'.$2`);
    if (next !== src) await putSrc(next); else msgText(`Add WHEN '${code}' to the tab module of ${c.name} in the program`);
    draw();
  }
  function drawProg() {
    const m = V.model;
    const sub = m.screens.subc;
    V.part ||= m.screens.screens.length || sub === 'M' ? 'screens' : 'texts';
    const parts = [['screens', `Screens${m.screens.screens.length ? ` (${m.screens.screens.length})` : ''}`], ['status', 'GUI status and titles'], ['texts', 'Text elements']];
    body.innerHTML = `<div class="ve-parts" role="tablist">${parts.map(([p, t]) => `<button class="ve-part${V.part === p ? ' on' : ''}" role="tab" aria-selected="${V.part === p}" data-do="part" data-p="${p}">${esc(t)}</button>`).join('')}</div><div class="ve-partbody"></div>`;
    const pb = body.querySelector('.ve-partbody');
    if (V.part === 'screens') drawScreens(pb);
    if (V.part === 'status') drawStatus(pb);
    if (V.part === 'texts') drawTexts(pb);
  }
  function drawScreens(pb) {
    const sc = V.model.screens, s = sc.screens[V.screen];
    const S = `screens.screens.${V.screen}`;
    const f = s?.fields[V.sel], c = s?.containers?.[V.selC];
    const conts = s ? s.containers.map((x, i) => [x, i]).filter(([x]) => x.type !== 'SCREEN') : [];
    const tcCols = ct => { const cols = []; for (const fl of s.fields.filter(x => x.contName === ct.name && x.contType === ct.type)) { const col = cols[fl.column - 1] ||= { column: fl.column }; if (fl.type === 'TEXT') col.head = fl; else col.field = fl; } return cols.filter(Boolean); };
    pb.innerHTML = `<div class="ve-sec"><div class="ve-tabs">${sc.screens.map((x, i) => `<button class="ve-tabb${i === V.screen ? ' on' : ''}" data-do="tab" data-i="${i}">${esc(x.screen)} ${esc(x.descript)}</button>`).join('')}<button class="btn sm" data-do="addScreen">+ Screen</button><button class="btn sm" data-do="addScreen" data-sub="1" title="A subscreen (type I) for a subscreen area or a tab">+ Subscreen</button></div>
      ${!s ? `<p class="ve-note">${esc(sc.program)} has no screens yet${sc.subc && sc.subc !== 'M' ? ' (screens belong to module pools: program type M)' : ''}. Add one.</p>` : `
      <div class="ve-grid2"><label>Description</label>${inp(`${S}.descript`, s.descript)}<label>Type</label>${sel(`${S}.type`, s.type, [['N', 'Normal'], ['I', 'Subscreen'], ['M', 'Modal dialog box']])}<label>Next screen</label>${inp(`${S}.next`, s.next, 'class="w6 mono"')}<label>Size</label><span>${num(`${S}.lines`, s.lines, 'min="1" class="w5"')} lines × ${num(`${S}.columns`, s.columns, 'min="1" class="w5"')} columns</span></div></div>
      <div class="ve-cols"><div class="ve-main"><div class="ve-sec"><h4>Layout</h4>
        <div class="ve-palette">${[['TEXT', 'Text'], ['TEMPLATE', 'Input/output'], ['LISTBOX', 'Dropdown'], ['CHECK', 'Checkbox'], ['RADIO', 'Radio button'], ['PUSH', 'Push button'], ['FRAME', 'Frame']].map(([t, l]) => `<button class="btn sm" data-do="addEl" data-t="${t}">+ ${l}</button>`).join('')}<button class="btn sm primary" data-do="picker" title="Input/output fields with labels for the components of a structure, table or program variable (Get from Dictionary/Program)">+ Fields from dictionary…</button><button class="btn sm" data-do="tcWizard">+ Table control</button><button class="btn sm" data-do="tsWizard">+ Tabstrip</button><button class="btn sm" data-do="addSub">+ Subscreen area</button>${s.fields.some(x => x.type === 'OKCODE') ? '' : '<button class="btn sm" data-do="addOk">+ OK code</button>'}</div>
        <div class="ve-canvas-wrap"><div class="ve-canvas" tabindex="-1" aria-label="Screen layout: select an element, Delete removes it" style="width:${s.columns * CW}px;height:${Math.max(6, s.lines, ...s.fields.map(x => x.line)) * RH}px">
          ${conts.map(([x, i]) => x.type === 'STRIP_CTRL' ? `<div class="ve-cont ts${i === V.selC ? ' sel' : ''}" data-ci="${i}" style="left:${(x.column - 1) * CW}px;top:${(x.line - 1) * RH}px;width:${x.length * CW}px;height:${Math.max(3, x.height) * RH}px" title="Tabstrip ${esc(x.name)}"><div class="ve-tsh">${s.fields.filter(f => f.contType === 'STRIP_CTRL' && f.contName === x.name).sort((p, q) => p.column - q.column).map((f, k) => `<span class="${k ? '' : 'on'}">${esc(f.text || f.name)}</span>`).join('')}</div><div class="ve-tcn">${esc(x.name)}</div></div>` : x.type === 'TABLE_CTRL' ? `<div class="ve-cont tc${i === V.selC ? ' sel' : ''}" data-ci="${i}" style="left:${(x.column - 1) * CW}px;top:${(x.line - 1) * RH}px;width:${x.length * CW}px;height:${Math.max(3, x.height) * RH}px" title="Table control ${esc(x.name)}"><div class="ve-tch">${tcCols(x).map(col => `<span style="width:${(col.field?.vislength || col.field?.length || col.head?.length || 8) * CW}px">${esc(col.head?.text || col.field?.name.split('-').pop() || '')}</span>`).join('')}</div><div class="ve-tcn">${esc(x.name)}</div></div>`
            : `<div class="ve-cont sub${i === V.selC ? ' sel' : ''}" data-ci="${i}" style="left:${(x.column - 1) * CW}px;top:${(x.line - 1) * RH}px;width:${x.length * CW}px;height:${Math.max(1, x.height) * RH}px" title="${esc(x.type)} ${esc(x.name)}">${esc(x.type === 'SUBSCREEN' ? 'Subscreen area' : x.type)} ${esc(x.name)}</div>`).join('')}
          ${s.fields.map((x, i) => x.type === 'OKCODE' || x.contType !== 'SCREEN' ? '' : `<div class="ve-el t-${x.type.toLowerCase()}${x.type === 'TEXT' ? ' txt' : ' inp'}${i === V.sel ? ' sel' : ''}${x.required ? ' req' : ''}" data-fi="${i}" style="left:${(x.column - 1) * CW}px;top:${(x.line - 1) * RH}px;width:${x.length * CW}px${x.type === 'FRAME' ? `;height:${Math.max(2, x.height) * RH - 4}px` : ''}" title="${esc(x.name)}">${esc(elLabel(x))}</div>`).join('')}
        </div></div>
        <p class="ve-note">Drag elements on the grid (one column = one character, one row = one line). OK code field: ${esc(s.fields.find(x => x.type === 'OKCODE')?.name || 'none')}. Input/output fields show and change the program's global variable of the same name (also structure components: GS_HEAD-EBELN).</p></div>
        ${flowHtml()}</div>
      <div class="ve-side">${V.picker ? pickerHtml() : V.tsWizard ? tsWizardHtml() : V.wizard ? wizardHtml() : c ? contHtml(c, S, tcCols(c)) : f ? fieldHtml(f, S) : '<h4>Element</h4><p class="ve-note">Select an element on the layout, or add one.</p>'}</div></div>`}`;
    pb.querySelectorAll('[data-wz]').forEach(x => x.oninput = () => { V.wizard[x.dataset.wz] = x.value; });
    pb.querySelectorAll('[data-wlabel]').forEach(x => x.oninput = () => { V.wizard.cols[Number(x.dataset.wlabel)].newLabel = x.value; });
    pb.querySelectorAll('[data-plabel]').forEach(x => x.oninput = () => { V.picker.comps[Number(x.dataset.plabel)].newLabel = x.value; });
    pb.querySelectorAll('[data-tw]').forEach(x => x.oninput = () => { V.tsWizard[x.dataset.tw] = x.value; });
    pb.querySelectorAll('[data-pk]').forEach(x => { x.oninput = () => { V.picker[x.dataset.pk] = x.dataset.pk === 'prefix' ? x.value.toUpperCase() : x.value; }; if (x.dataset.pk === 'source') x.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); pickerLoad(); } }; });
    pb.querySelectorAll('[data-pc]').forEach(x => x.onchange = () => { V.picker.chosen[Number(x.dataset.pc)] = x.checked; });
    pb.querySelectorAll('[data-pf]').forEach(x => x.onchange = () => { V.picker[x.dataset.pf] = x.checked; });
    pb.querySelectorAll('[data-tch]').forEach(x => x.oninput = () => change(m => { const [col, k] = x.dataset.tch.split('|'); const ct = m.screens.screens[V.screen].containers[V.selC]; const fl = m.screens.screens[V.screen].fields.find(y => y.contName === ct.name && y.column === Number(col) && (k === 'head' ? y.type === 'TEXT' : y.type !== 'TEXT')); if (!fl) return false; if (k === 'head') { fl.text = x.value; fl.length = Math.max(1, x.value.length); } if (k === 'name') fl.name = x.value.toUpperCase(); if (k === 'len') { fl.length = Number(x.value) || 1; fl.vislength = fl.length; } if (k === 'in') fl.input = x.checked; }, x.type !== 'checkbox'));
    const ft = pb.querySelector('#veFlow');
    if (ft) {
      ft.oninput = () => { V.flow.text = ft.value; V.flow.dirty = true; pb.querySelector('.ve-flowstate').textContent = '(not saved)'; };
      // where the cursor is: the templates go there (after that line)
      const caret = () => { V.flowCaret = ft.value.slice(0, ft.selectionStart).split('\n').length; };
      ft.onkeyup = caret; ft.onclick = caret; ft.onselect = caret;
    }
    // drag on the character grid: elements and containers
    const drag = (el, apply) => el.onpointerdown = ev => {
      if (ev.button !== 0) return;
      ev.preventDefault();
      pb.querySelector('.ve-canvas')?.focus({ preventScroll: true });
      const x0 = ev.clientX, y0 = ev.clientY, l0 = el.offsetLeft, t0 = el.offsetTop;
      let moved = false;
      const mv = e => { moved = true; el.style.left = `${Math.max(0, l0 + e.clientX - x0)}px`; el.style.top = `${Math.max(0, t0 + e.clientY - y0)}px`; };
      const up = e => { document.removeEventListener('pointermove', mv); document.removeEventListener('pointerup', up); const col = Math.max(1, Math.round((l0 + e.clientX - x0) / CW) + 1), line = Math.max(1, Math.round((t0 + e.clientY - y0) / RH) + 1); apply(moved ? { col, line } : null); };
      document.addEventListener('pointermove', mv); document.addEventListener('pointerup', up);
    };
    pb.querySelectorAll('.ve-el').forEach(el => drag(el, p => { const i = Number(el.dataset.fi); V.sel = i; V.selC = -1; V.wizard = null; if (p) change(m => { const fl = m.screens.screens[V.screen].fields[i]; if (fl.column === p.col && fl.line === p.line) return false; fl.column = p.col; fl.line = p.line; }); draw(); }));
    pb.querySelectorAll('.ve-cont').forEach(el => drag(el, p => { const i = Number(el.dataset.ci); V.selC = i; V.sel = -1; V.wizard = null; if (p) change(m => { const ct = m.screens.screens[V.screen].containers[i]; if (ct.column === p.col && ct.line === p.line) return false; ct.column = p.col; ct.line = p.line; }); draw(); }));
  }
  function fieldHtml(f, S) {
    const P = `${S}.fields.${V.sel}`;
    const t = f.type;
    return `<h4>${esc(f.dropdown ? 'Dropdown list' : C.ELEMENT_TYPES[t] || t)}</h4><div class="ve-grid2">
      <label>Name</label>${inp(`${P}.name`, f.name, 'class="mono"')}
      ${/^(TEXT|CHECK|RADIO|PUSH|FRAME)$/.test(t) ? `<label>Text</label>${inp(`${P}.text`, f.text)}` : ''}
      ${t !== 'OKCODE' ? `<label>Line</label>${num(`${P}.line`, f.line, 'min="1" class="w5"')}<label>Column</label>${num(`${P}.column`, f.column, 'min="1" class="w5"')}` : ''}
      <label>Length</label>${num(`${P}.length`, f.length, 'min="1" class="w5"')}${t === 'FRAME' ? `<label>Height</label>${num(`${P}.height`, f.height, 'min="2" class="w5"')}` : ''}
      ${t === 'TEMPLATE' ? `<label>Format</label>${sel(`${P}.format`, f.format, ['CHAR', 'NUMC', 'DEC', 'INT4', 'DATS', 'TIMS', 'CURR', 'QUAN', 'CUKY', 'UNIT'])}<label>Dropdown</label>${sel(`${P}.dropdown`, f.dropdown, [['', 'No'], ['L', 'Listbox'], ['K', 'Listbox with key']])}` : ''}
      ${/^(TEMPLATE|CHECK|RADIO)$/.test(t) ? `<label>Input</label>${chk(`${P}.input`, f.input, 'ready for input')}<label>Output</label>${chk(`${P}.output`, f.output, 'shows the value')}` : ''}
      ${t === 'TEMPLATE' ? `<label>Required</label>${chk(`${P}.required`, f.required, 'required entry')}` : ''}
      ${t === 'PUSH' ? `<label>Function code</label>${inp(`${P}.fcode`, f.fcode, 'class="mono"')}` : ''}</div>
      <p><button class="btn sm" data-do="del" data-l="${S}.fields" data-i="${V.sel}">Delete element</button></p>
      <p class="ve-note">${t === 'PUSH' ? 'The function code arrives in the OK code field (sy-ucomm) at PAI.' : t === 'CHECK' || t === 'RADIO' ? 'The variable of the same name gets X when ticked (TYPE c LENGTH 1).' : t === 'TEMPLATE' ? 'Shows and changes the program\'s global variable of the same name.' : ''}</p>`;
  }
  function tsWizardHtml() {
    const w = V.tsWizard;
    return `<h4>New tabstrip</h4><div class="ve-grid2"><label>Name</label><input class="mono" data-tw="name" value="${esc(w.name)}"><label>Tabs</label><input data-tw="tabs" value="${esc(w.tabs)}" placeholder="Header, Items, Texts"><label>First subscreen</label><input class="mono w6" data-tw="first" value="${esc(w.first)}"><label>Height</label><input type="number" class="w5" data-tw="height" value="${esc(w.height)}"></div>
      <p class="ve-note">A tab per name, each shows its own subscreen (type I, numbered from the first). The program gets CONTROLS … TYPE TABSTRIP, the shown subscreen and the modules that switch the tab; the flow logic CALL SUBSCREEN in PBO and PAI.</p>
      <p><button class="btn sm primary" data-do="tsCreate">Create tabstrip</button> <button class="btn sm ghost" data-do="tcCancel">Cancel</button></p>`;
  }
  function contHtml(c, S, cols) {
    const P = `${S}.containers.${V.selC}`;
    if (c.type === 'STRIP_CTRL') {
      const s = V.model.screens.screens[V.screen];
      const tabs = s.fields.map((f, i) => [f, i]).filter(([f]) => f.contType === 'STRIP_CTRL' && f.contName === c.name).sort(([p], [q]) => p.column - q.column);
      return `<h4>Tabstrip</h4><div class="ve-grid2"><label>Name</label><b class="mono">${esc(c.name)}</b><label>Line</label>${num(`${P}.line`, c.line, 'min="1" class="w5"')}<label>Column</label>${num(`${P}.column`, c.column, 'min="1" class="w5"')}<label>Width</label>${num(`${P}.length`, c.length, 'min="1" class="w5"')}<label>Height</label>${num(`${P}.height`, c.height, 'min="3" class="w5"')}</div>
        <h4>Tabs</h4><table class="ve-tab ve-small"><tr><th>Text</th><th>Function code</th></tr>${tabs.map(([f, i]) => `<tr><td>${inp(`${S}.fields.${i}.text`, f.text, 'class="w10"')}</td><td class="mono">${esc(f.fcode)}</td></tr>`).join('')}</table>
        <p><button class="btn sm" data-do="tsAddTab">+ Tab</button> <button class="btn sm" data-do="delC">Delete tabstrip</button></p>
        <p class="ve-note">Each tab shows a subscreen (the screen tabs above, type Subscreen): put the tab's fields there. PAI sets ${esc(c.name.toLowerCase())}-activetab from the tab's function code.</p>`;
    }
    return `<h4>${c.type === 'TABLE_CTRL' ? 'Table control' : 'Subscreen area'}</h4><div class="ve-grid2"><label>Name</label>${inp(`${P}.name`, c.name, 'class="mono"')}<label>Line</label>${num(`${P}.line`, c.line, 'min="1" class="w5"')}<label>Column</label>${num(`${P}.column`, c.column, 'min="1" class="w5"')}<label>Width</label>${num(`${P}.length`, c.length, 'min="1" class="w5"')}<label>Height</label>${num(`${P}.height`, c.height, 'min="1" class="w5"')}</div>
      ${c.type === 'TABLE_CTRL' ? `<h4>Columns</h4><table class="ve-tab ve-small"><tr><th>Heading</th><th>Field</th><th>Len.</th><th>Input</th><th></th></tr>${cols.map(col => `<tr><td><input class="w8" data-tch="${col.column}|head" value="${esc(col.head?.text || '')}"></td><td><input class="mono w10" data-tch="${col.column}|name" value="${esc(col.field?.name || '')}"></td><td><input type="number" class="w4" data-tch="${col.column}|len" value="${col.field?.length || ''}"></td><td><input type="checkbox" data-tch="${col.column}|in"${col.field?.input ? ' checked' : ''}></td><td><button class="x" data-do="tcDelCol" data-col="${col.column}" title="Remove the column">✕</button></td></tr>`).join('')}</table>
        <p><button class="btn sm" data-do="tcAddCol">+ Column</button></p><p class="ve-note">The flow logic loops over the internal table (LOOP AT … WITH CONTROL ${esc(c.name.toLowerCase())}); the columns are components of the work area.</p>`
      : `<p class="ve-note">PBO: CALL SUBSCREEN ${esc(c.name.toLowerCase())} INCLUDING sy-repid '0200'. PAI: CALL SUBSCREEN ${esc(c.name.toLowerCase())}. Add a subscreen (type I) with + Subscreen.</p>`}
      <p><button class="btn sm" data-do="delC">Delete ${c.type === 'TABLE_CTRL' ? 'table control' : 'subscreen area'}</button></p>`;
  }
  function wizardHtml() {
    const w = V.wizard;
    return `<h4>New table control</h4><div class="ve-grid2"><label>Name</label><input class="mono" data-wz="name" value="${esc(w.name)}"><label>Internal table</label><input class="mono" data-wz="table" value="${esc(w.table)}"><label>Work area</label><input class="mono" data-wz="wa" value="${esc(w.wa)}"><label>Line type</label><input class="mono" data-wz="lineType" list="veTypes" value="${esc(w.lineType)}" placeholder="a structure or table, e.g. ZPO_S_ITEM"><label>Visible rows</label><input type="number" class="w5" data-wz="height" value="${esc(w.height)}"></div>
      ${w.cols && w.colsOf === w.lineType.trim().toLowerCase() ? `<p class="ve-note">${w.cols.length} columns: ${w.cols.slice(0, 12).map(c => esc(c.noLabel ? c.name : c.label)).join(', ')}</p>${labelInputs(w.cols.slice(0, 12), 'data-wlabel')}` : '<p><button class="btn sm" data-do="tcCols">Show columns</button></p>'}
      <p class="ve-note">Columns for the components of the line type. The program gets CONTROLS, the internal table, the work area and a module that writes changed rows back; the flow logic the LOOP … WITH CONTROL in PBO and PAI.</p>
      <p><button class="btn sm primary" data-do="tcCreate">Create table control</button> <button class="btn sm ghost" data-do="tcCancel">Cancel</button></p>`;
  }
  function flowHtml() {
    if (!V.flow) return '<div class="ve-sec"><h4>Flow logic</h4><span class="ve-note">Loading…</span></div>';
    const miss = V.src !== undefined ? C.missingModules(V.flow.text, V.src || '') : [];
    return `<div class="ve-sec"><h4>Flow logic <small>${esc(V.flow.file.replace(/^src\//, ''))} <span class="ve-flowstate">${V.flow.dirty ? '(not saved)' : ''}</span></small> <span class="ve-btns"><button class="btn sm primary" data-do="flowSave">Save flow logic</button></span></h4>
      <div class="ve-palette">${C.FLOW_TEMPLATES.map(([k, l, part]) => `<button class="btn sm" data-do="flowTpl" data-t="${k}" title="Adds it to ${part === 'pbo' ? 'PROCESS BEFORE OUTPUT' : part === 'pai' ? 'PROCESS AFTER INPUT' : 'PROCESS ON VALUE-REQUEST'}">+ ${esc(l)}</button>`).join('')}</div>
      <textarea id="veFlow" class="ve-code mono" spellcheck="false" rows="${Math.min(22, Math.max(8, V.flow.text.split('\n').length + 1))}">${esc(V.flow.text)}</textarea>
      ${miss.length ? `<p class="ve-warn">Not in the program yet: ${miss.map(x => `MODULE ${esc(x.name)} ${x.kind.toUpperCase()}`).join(', ')} <button class="btn sm" data-do="flowModules">Create them</button></p>` : ''}</div>`;
  }
  function drawStatus(pb) {
    const cua = V.model.cua;
    const used = C.statusesUsed(V.src || ''), titles = C.titlesUsed(V.src || '');
    if (V.src === undefined) getSrc().then(() => { if (V.part === 'status') draw(); });
    V.status = Math.min(V.status || 0, Math.max(0, cua.statuses.length - 1));
    const s = cua.statuses[V.status];
    const P = `cua.statuses.${V.status}`;
    const fopts = [['', '—'], ...cua.functions.map(f => [f.code, `${f.code}${f.text ? ` · ${f.text}` : ''}`])];
    const keyRow = ([pf, label]) => `<tr><td>${esc(label)}</td><td><select data-key="${pf}">${fopts.map(([v, l]) => `<option value="${esc(v)}"${(s.keys[pf] || '') === v ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></td></tr>`;
    const missing = used.filter(c => !cua.statuses.some(x => x.code === c)), missingT = titles.filter(c => !cua.titles.some(x => x.code === c));
    pb.innerHTML = `${missing.length || missingT.length ? `<div class="ve-sec ve-warn">The program sets ${[...missing.map(c => `PF-STATUS '${esc(c)}' <button class="btn sm" data-do="addStatus" data-code="${esc(c)}">Create it</button>`), ...missingT.map(c => `TITLEBAR '${esc(c)}' <button class="btn sm" data-do="addTitle" data-code="${esc(c)}">Create it</button>`)].join(' · ')}, which do not exist yet.</div>` : ''}
      <div class="ve-sec"><div class="ve-tabs">${cua.statuses.map((x, i) => `<button class="ve-tabb${i === V.status ? ' on' : ''}" data-do="stTab" data-i="${i}">${esc(x.code)}</button>`).join('')}<button class="btn sm" data-do="addStatus">+ GUI status</button></div>
      ${!s ? '<p class="ve-note">No GUI status yet. A status gives the screen its toolbar, function keys and menu (SET PF-STATUS \'MAIN\' in a PBO module).</p>' : `
      <div class="ve-grid2"><label>Status</label>${inp(`${P}.code`, s.code, 'class="mono w10"')}<label>Short text</label>${inp(`${P}.text`, s.text)}<label>Kind</label>${sel(`${P}.modal`, s.modal, [['D', 'Dialog status'], ['P', 'Dialog box'], ['L', 'List status']])}</div></div>
      <div class="ve-cols"><div class="ve-main">
        <div class="ve-sec"><h4>Functions <span class="ve-btns"><button class="btn sm" data-do="addFun">+ Function</button></span></h4>
          <table class="ve-tab"><tr><th>Function code</th><th>Text</th><th>Icon</th><th>Icon text</th><th title="Exit command: runs MODULE … AT EXIT-COMMAND, no input checks">Exit</th><th></th></tr>
          ${cua.functions.map((f, i) => `<tr><td><input class="mono w10" data-fcode="${i}" value="${esc(f.code)}" aria-label="Function code"></td><td>${inp(`cua.functions.${i}.text`, f.text)}</td><td>${sel(`cua.functions.${i}.icon`, f.icon, C.ICONS.map(x => [x, x ? x.replace(/^ICON_/, '').toLowerCase().replace(/_/g, ' ') : '—']))}</td><td>${inp(`cua.functions.${i}.iconText`, f.iconText, 'class="w8"')}</td><td>${chk(`cua.functions.${i}.exit`, f.exit)}</td>${rowBtns('cua.functions', i)}</tr>`).join('')}</table></div>
        <div class="ve-sec"><h4>Application toolbar <span class="ve-btns"><button class="btn sm" data-do="addBtn">+ Button</button><button class="btn sm" data-do="addSep">+ Separator</button></span></h4>
          <div class="ve-toolbar">${s.toolbar.map((code, i) => code === '-' ? `<span class="ve-sepb">| <button class="x" data-do="del" data-l="${P}.toolbar" data-i="${i}" title="Remove">✕</button></span>` : `<span class="ve-tbtn">${sel(`${P}.toolbar.${i}`, code, fopts.slice(1))}<button class="x" data-do="up" data-l="${P}.toolbar" data-i="${i}" title="Move left">←</button><button class="x" data-do="down" data-l="${P}.toolbar" data-i="${i}" title="Move right">→</button><button class="x" data-do="del" data-l="${P}.toolbar" data-i="${i}" title="Remove">✕</button></span>`).join('') || '<span class="ve-note">No buttons</span>'}</div>
          <p class="ve-note">A button needs a function key: functions without one get a free key (Shift+Ctrl+…) when saved.</p></div>
        <div class="ve-sec"><h4>Menus <span class="ve-btns"><button class="btn sm" data-do="addMenu">+ Menu</button></span></h4>
          <table class="ve-tab"><tr><th>Menu</th><th>Entries (function codes, - for a separator)</th><th></th></tr>${cua.menus.map((x, i) => `<tr><td>${inp(`cua.menus.${i}.text`, x.text, 'class="w10"')}</td><td><input class="mono wide" data-menu="${i}" value="${esc(x.items.join(', '))}"></td>${rowBtns('cua.menus', i)}</tr>`).join('')}</table></div>
      </div><div class="ve-side"><h4>Function keys</h4><table class="ve-tab ve-small"><tr><th>Key</th><th>Function</th></tr>${C.STANDARD_KEYS.map(keyRow).join('')}<tr><td colspan="2" class="ve-note">Free keys</td></tr>${C.FREE_KEYS.map(keyRow).join('')}</table></div></div>`}
      <div class="ve-sec"><h4>Titles (SET TITLEBAR) <span class="ve-btns"><button class="btn sm" data-do="addTitle">+ Title</button></span></h4><table class="ve-tab"><tr><th>Title code</th><th>Text</th><th></th></tr>${cua.titles.map((t, i) => `<tr><td>${inp(`cua.titles.${i}.code`, t.code, 'class="mono w10"')}</td><td>${inp(`cua.titles.${i}.text`, t.text, 'class="wide"')}</td>${rowBtns('cua.titles', i)}</tr>`).join('')}</table></div>`;
    // renaming a function code renames it on the function keys, the toolbar and in the menus too
    pb.querySelectorAll('[data-fcode]').forEach(x => { x.oninput = () => { x.value = x.value.toUpperCase().replace(/[^A-Z0-9_%]/g, ''); }; x.onchange = () => change(m => {
      const f = m.cua.functions[Number(x.dataset.fcode)], old = f.code, nu = x.value.trim().toUpperCase();
      if (!nu || nu === old) return false;
      if (m.cua.functions.some(y => y !== f && y.code === nu)) { msgText(`${nu} exists already`); return false; }
      f.code = nu;
      for (const st of m.cua.statuses) {
        for (const k of Object.keys(st.keys)) if (st.keys[k] === old) st.keys[k] = nu;
        st.toolbar = st.toolbar.map(t => (t === old ? nu : t));
        st.assigned = (st.assigned || []).map(t => (t === old ? nu : t));
      }
      for (const mn of m.cua.menus) mn.items = mn.items.map(t => (t === old ? nu : t));
    }); });
    pb.querySelectorAll('[data-key]').forEach(x => x.onchange = () => change(m => { const st = m.cua.statuses[V.status]; if (x.value) st.keys[x.dataset.key] = x.value; else delete st.keys[x.dataset.key]; }));
    pb.querySelectorAll('[data-menu]').forEach(x => x.onchange = () => change(m => { m.cua.menus[Number(x.dataset.menu)].items = x.value.split(/[\s,]+/).map(v => v.toUpperCase()).filter(Boolean); }));
  }
  function drawTexts(pb) {
    const t = V.model.tpool;
    if (V.src === undefined) getSrc().then(() => { if (V.part === 'texts') draw(); });
    const src = V.src || '';
    // the selection screen's parameters (from the source) and the TEXT-nnn the program uses
    const names = C.selectionNames(src);
    for (const n of names) if (!t.selections.some(x => x.key === n)) t.selections.push({ key: n, text: '', ddic: false });
    const usedSyms = C.textSymbolsUsed(src).filter(k => !t.symbols.some(x => x.key === k));
    pb.innerHTML = `<div class="ve-sec"><div class="ve-grid2"><label>Title</label><input data-tt="title" value="${esc(t.title)}" class="wide" maxlength="70"></div></div>
      <div class="ve-sec"><h4>Selection texts <small>${names.length ? 'of PARAMETERS and SELECT-OPTIONS' : ''}</small></h4>
        ${t.selections.length ? `<table class="ve-tab"><tr><th>Name</th><th>Text on the selection screen</th><th title="Dictionary reference: the data element's label, also when it changes">Dictionary ref.</th><th></th></tr>${t.selections.map((x, i) => { const inProg = names.includes(x.key), info = V.ddicLabels?.[x.key], noDtel = !!info?.noDtel, why = info?.error || '';
          // a parameter without a data element (built-in type): no dictionary reference; the reason as the tooltip
          return `<tr><td class="mono">${esc(x.key)}${inProg ? '' : ' <small class="ve-note">(not in the program)</small>'}</td>
          <td>${x.ddic ? `<input class="wide" disabled value="${esc(info?.label || '')}" placeholder="${esc(info ? (info.label ? '' : 'no label') : '…')}" title="${esc(why || 'From the data element')}">` : `<input data-sel="${i}" value="${esc(x.text)}" class="wide" maxlength="30" placeholder="${esc(x.key)}">`}</td>
          <td><label class="ve-chk" title="${esc(!inProg ? `${x.key} is not in the program` : noDtel && !x.ddic ? why : 'Dictionary reference: the data element\'s label, also when it changes')}"><input type="checkbox" data-seld="${i}" aria-label="Dictionary reference for ${esc(x.key)}"${x.ddic ? ' checked' : ''}${(noDtel && !x.ddic) || !inProg ? ' disabled' : ''}></label></td>
          <td class="ve-ops">${x.ddic || !inProg ? '' : `<button class="btn sm" data-do="ddicText" data-key="${esc(x.key)}"${noDtel && !info?.copy ? ` disabled title="${esc(why)}"` : ` title="${esc(info?.copy ? 'Copy the field\'s label (@EndUserText.label)' : 'Copy the data element\'s label (PARAMETERS … TYPE <data element> / SELECT-OPTIONS … FOR <table>-<field>)')}"`}>From dictionary</button>`}${inProg ? '' : `<button class="x" data-do="del" data-l="tpool.selections" data-i="${i}" title="Delete the text: ${esc(x.key)} is not in the program" aria-label="Delete the selection text of ${esc(x.key)}">✕</button>`}</td></tr>`; }).join('')}</table>` : '<p class="ve-note">The program has no PARAMETERS or SELECT-OPTIONS.</p>'}</div>
      <div class="ve-sec"><h4>Text symbols (TEXT-nnn) <span class="ve-btns"><button class="btn sm" data-do="addSym">+ Text symbol</button></span></h4>
        ${usedSyms.length ? `<p class="ve-warn ve-bar-line">Used in the program but not defined: ${usedSyms.map(k => `TEXT-${esc(k)} <button class="btn sm" data-do="addSym" data-key="${esc(k)}">Add</button>`).join(' ')}</p>` : C.textSymbolsUsed(src).length ? '<p class="ve-note ve-bar-line">✓ Every TEXT-nnn the program uses is defined.</p>' : ''}
        <table class="ve-tab"><tr><th>Key</th><th>Text</th><th>Max. length</th><th></th></tr>${t.symbols.map((x, i) => `<tr><td><input class="mono w4" data-sym="${i}|key" value="${esc(x.key)}" maxlength="3"></td><td><input class="wide" data-sym="${i}|text" value="${esc(x.text)}"></td><td><input type="number" class="w4" data-sym="${i}|length" value="${esc(x.length)}"></td>${rowBtns('tpool.symbols', i)}</tr>`).join('')}</table></div>
      <div class="ve-sec"><h4>List headings <span class="ve-btns"><button class="btn sm" data-do="addHead">+ Heading line</button></span></h4><table class="ve-tab">${t.headings.map((x, i) => `<tr><td class="mono">${esc(x.key)}</td><td><input class="wide mono" data-head="${i}" value="${esc(x.text)}"></td>${rowBtns('tpool.headings', i)}</tr>`).join('')}</table>
        <p class="ve-note">Column headings of a WRITE list (shown above the list).</p></div>`;
    pb.querySelector('[data-tt]').oninput = e => change(m => { m.tpool.title = e.target.value; }, true);
    pb.querySelectorAll('[data-sel]').forEach(x => x.oninput = () => change(m => { const i = Number(x.dataset.sel); for (const n of names) if (!m.tpool.selections.some(y => y.key === n)) m.tpool.selections.push({ key: n, text: '', ddic: false }); m.tpool.selections[i].text = x.value; m.tpool.selections[i].ddic = false; }, true));
    pb.querySelectorAll('[data-seld]').forEach(x => x.onchange = () => change(m => { const i = Number(x.dataset.seld); for (const n of names) if (!m.tpool.selections.some(y => y.key === n)) m.tpool.selections.push({ key: n, text: '', ddic: false }); const sl = m.tpool.selections[i]; if (x.checked && V.ddicLabels?.[sl.key]?.noDtel) return false; sl.ddic = x.checked; if (x.checked) sl.text = ''; }));
    // what the dictionary says about each parameter of the program: its data element's label, or why there is none
    // (kept apart from the texts: an explanation is never written into the text pool)
    V.ddicLabels ||= {};
    const todo = t.selections.filter(x => names.includes(x.key) && V.ddicLabels[x.key] === undefined);
    if (todo.length) Promise.all(todo.map(async x => { V.ddicLabels[x.key] = await ddicLabel(x.key).catch(e => ({ error: e.message })); })).then(() => { if (V.part === 'texts') draw(); });
    pb.querySelectorAll('[data-sym]').forEach(x => x.oninput = () => change(m => { const [i, k] = x.dataset.sym.split('|'); m.tpool.symbols[Number(i)][k] = k === 'length' ? Number(x.value) || 0 : k === 'key' ? x.value.toUpperCase() : x.value; }, true));
    pb.querySelectorAll('[data-head]').forEach(x => x.oninput = () => change(m => { m.tpool.headings[Number(x.dataset.head)].text = x.value; }, true));
  }

  // ---------------------------------------------------------------- domains, data elements, table types
  function ddicAct(a, d) {
    if (a === 'addFix') return change(m => { m.fixed.push({ low: '', high: '', text: '' }); });
    if (a === 'labels') return change(m => { const w = (t, n) => { if (t.length <= n) return t; let o = ''; for (const x of t.split(/\s+/)) { if ((o ? `${o} ${x}` : x).length > n) break; o = o ? `${o} ${x}` : x; } return o || t.slice(0, n); }; m.short = w(m.text, 10); m.medium = w(m.text, 20); m.long = w(m.text, 40); m.heading = w(m.text, 55); });
    if (a === 'typeKind') return change(m => { if (d.v === 'domain') { m.domain = m.domain || ''; } else m.domain = ''; V.dtelBuiltin = d.v !== 'domain'; });
    void d;
  }
  const typeRows = (m, prefix = '') => { const fixed = FIXED_LEN[m.datatype] !== undefined; return `<label>Data type</label>${sel(`${prefix}datatype`, m.datatype, DDIC.map(([k, l]) => [k, `${k} · ${l}`]))}
    <label>Length</label>${fixed ? `<span class="ve-note">${FIXED_LEN[m.datatype] || 'variable'} (fixed)</span>` : num(`${prefix}length`, m.length, 'min="1" class="w5"')}
    ${HAS_DEC.test(m.datatype) ? `<label>Decimals</label>${num(`${prefix}decimals`, m.decimals, 'min="0" max="14" class="w5"')}` : ''}`; };
  function drawDoma() {
    const m = V.model;
    body.innerHTML = `<div class="ve-sec"><div class="ve-grid2"><label>Domain</label><b>${esc(m.name)}</b><label>Description</label>${inp('text', m.text, 'class="wide" maxlength="60"')}${typeRows(m)}
      <label>Output length</label>${num('outputlen', m.outputlen, 'min="0" class="w5"')}<label>Sign</label>${chk('sign', m.sign, 'negative values allowed')}<label>Lower case</label>${chk('lowercase', m.lowercase, 'lower case letters allowed')}
      <label>Value table</label>${inp('valueTable', m.valueTable, 'class="mono w14" list="veTabs" placeholder="optional"')}<label>Conversion routine</label>${inp('convexit', m.convexit, 'class="mono w6" placeholder="e.g. ALPHA"')}</div>
      <datalist id="veTabs">${V.meta.tables.map(x => `<option value="${esc(String(x).toUpperCase())}">`).join('')}</datalist></div>
      <div class="ve-sec"><h4>Fixed values <span class="ve-btns"><button class="btn sm" data-do="addFix">+ Value</button></span></h4>
      <table class="ve-tab"><tr><th>Value</th><th>Upper limit (interval)</th><th>Text</th><th></th></tr>${m.fixed.map((v, i) => `<tr><td>${inp(`fixed.${i}.low`, v.low, `class="mono w10" maxlength="${m.length || 10}"`)}</td><td>${inp(`fixed.${i}.high`, v.high, 'class="mono w10"')}</td><td>${inp(`fixed.${i}.text`, v.text, 'class="wide" maxlength="60"')}</td>${rowBtns('fixed', i)}</tr>`).join('') || '<tr><td colspan="4" class="ve-note">No fixed values: any value of the type is allowed.</td></tr>'}</table></div>`;
  }
  function drawDtel() {
    const m = V.model;
    const builtin = V.dtelBuiltin ?? !m.domain;
    const lim = (k, n) => `<span class="ve-note ve-count">${(m[k] || '').length}/${n}</span>`;
    body.innerHTML = `<div class="ve-sec"><div class="ve-grid2"><label>Data element</label><b>${esc(m.name)}</b><label>Description</label>${inp('text', m.text, 'class="wide" maxlength="60"')}
      <label>Type</label><span><label class="ve-chk"><input type="radio" name="veTk" data-do="typeKind" data-v="domain"${builtin ? '' : ' checked'}> Domain</label> <label class="ve-chk"><input type="radio" name="veTk" data-do="typeKind" data-v="builtin"${builtin ? ' checked' : ''}> Built-in type</label></span>
      ${builtin ? typeRows(m) : `<label>Domain</label><span>${inp('domain', m.domain, 'class="mono w14" list="veDoms"')} <datalist id="veDoms">${V.meta.domains.map(x => `<option value="${esc(String(x).toUpperCase())}">`).join('')}</datalist>${V.metaLoaded && m.domain && !V.meta.domains.includes(m.domain.toLowerCase()) && /^z/i.test(m.domain) ? '<span class="ve-err-inline">not in this app</span>' : ''}</span>`}</div></div>
      <div class="ve-sec"><h4>Field labels <span class="ve-btns"><button class="btn sm" data-do="labels">From the description</button></span></h4><div class="ve-grid2">
        <label>Short (10)</label><span>${inp('short', m.short, 'maxlength="10" class="w10"')} ${lim('short', 10)}</span>
        <label>Medium (20)</label><span>${inp('medium', m.medium, 'maxlength="20" class="w14"')} ${lim('medium', 20)}</span>
        <label>Long (40)</label><span>${inp('long', m.long, 'maxlength="40" class="wide"')} ${lim('long', 40)}</span>
        <label>Heading (55)</label><span>${inp('heading', m.heading, 'maxlength="55" class="wide"')} ${lim('heading', 55)}</span></div>
      <p class="ve-note">Screens and selection texts use the labels; lists and ALV columns the heading.</p></div>`;
    body.querySelectorAll('[data-do="typeKind"]').forEach(x => { x.removeAttribute('data-do'); x.onchange = () => { V.dtelBuiltin = x.dataset.v !== 'domain'; if (V.dtelBuiltin) change(mm => { mm.domain = ''; }); else draw(); }; });
  }
  function drawTtyp() {
    const m = V.model;
    const builtin = !m.rowtype;
    body.innerHTML = `<div class="ve-sec"><div class="ve-grid2"><label>Table type</label><b>${esc(m.name)}</b><label>Description</label>${inp('text', m.text, 'class="wide" maxlength="60"')}
      <label>Line type</label><span>${inp('rowtype', m.rowtype, 'class="mono w14" list="veTypes" placeholder="structure, table or data element"')} ${builtin ? '' : sel('rowkind', m.rowkind || 'S', [['S', 'Structure / table'], ['E', 'Data element']])}</span>
      ${builtin ? typeRows(m) : ''}
      <label>Access</label>${sel('access', m.access, [['T', 'Standard table'], ['S', 'Sorted table'], ['H', 'Hashed table'], ['I', 'Index table'], ['A', 'Any table']])}
      <label>Primary key</label>${sel('keydef', m.keydef, [['D', 'Standard key'], ['T', 'Table line'], ['K', 'Key components'], ['N', 'Not specified']])}
      <label>Key</label>${sel('keykind', m.keykind, [['N', 'Non-unique'], ['U', 'Unique'], ['G', 'Not specified']])}</div>
      <p class="ve-note">In ABAP: DATA lt_rows TYPE ${esc(m.name.toLowerCase())}. Empty line type: elementary lines of the data type.</p></div>`;
  }

  // ---------------------------------------------------------------- message class (SE91)
  function drawMsag() {
    const m = V.model, cls = file.split('/').pop().split('.')[0];
    body.innerHTML = `<div class="ve-sec"><div class="ve-grid2"><label>Message class</label><b>${esc(cls.toUpperCase())}</b></div></div>
      <div class="ve-sec"><h4>Messages <span class="ve-btns"><button class="btn sm" data-do="addMsg">+ Message</button></span></h4>
      <table class="ve-tab"><tr><th>Number</th><th>Text</th><th></th></tr>${m.messages.map((x, i) => `<tr><td>${inp(`messages.${i}.nr`, x.nr, 'class="mono w5" maxlength="3"')}</td><td>${inp(`messages.${i}.text`, x.text, 'class="wide" maxlength="73"')}</td>${rowBtns('messages', i)}</tr>`).join('') || '<tr><td colspan="3" class="ve-note">No messages yet.</td></tr>'}</table>
      <p class="ve-note">&amp;1 … &amp;4 are replaced by the WITH values: MESSAGE e002(${esc(cls)}) WITH lv_ebeln. Classes: MESSAGE … or new_message( id = '${esc(cls.toUpperCase())}' number = '002' severity = … v1 = … ).</p></div>`;
  }

  // ---------------------------------------------------------------- form interface (SFP): parameters, global data, initialization
  function drawSfpi() {
    const m = V.model;
    const rows = (list, P) => list.map((p, i) => `<tr><td>${inp(`${P}.${i}.name`, p.name, 'class="mono w12"')}</td><td>${inp(`${P}.${i}.type`, p.type, 'class="mono w14" list="veTypes"')}</td><td>${chk(`${P}.${i}.table`, p.table, 'TABLE OF')}</td>${rowBtns(P, i)}</tr>`).join('');
    body.innerHTML = `<div class="ve-sec"><div class="ve-grid2"><label>Form interface</label><b>${esc(file.split('/').pop().split('.')[0].toUpperCase())}</b><label>Description</label>${inp('description', m.description, 'class="wide"')}</div></div>
      <div class="ve-sec"><h4>Import parameters <span class="ve-btns"><button class="btn sm" data-do="addImp">+ Parameter</button></span></h4><table class="ve-tab"><tr><th>Name</th><th>Type</th><th>Table</th><th></th></tr>${rows(m.parameters, 'parameters')}</table>
        <p class="ve-note">The driver program passes them to the form's function module (FP_FUNCTION_MODULE_NAME).</p></div>
      <div class="ve-sec"><h4>Global data <span class="ve-btns"><button class="btn sm" data-do="addGlob">+ Global data</button></span></h4><table class="ve-tab"><tr><th>Name</th><th>Type</th><th>Table</th><th></th></tr>${rows(m.global, 'global')}</table></div>
      <div class="ve-sec"><h4>Initialization</h4><textarea class="ve-code mono" id="veInit" rows="${Math.max(6, m.init.split('\n').length + 1)}" spellcheck="false" placeholder="gv_count = lines( it_items ).">${esc(m.init)}</textarea>
        <p class="ve-note">ABAP that fills the global data from the import parameters, run by the classic engine before the layout is filled; the layout binds global data like parameters ($.GV_TITLE). The designer's preview shows sample values.</p></div>`;
    body.querySelector('#veInit').oninput = e => change(mm => { mm.init = e.target.value; }, true);
  }

  // ---------------------------------------------------------------- function module interface (SE37)
  function fmAct(a, d) {
    if (a === 'fmTab') { V.fmTab = d.s; return draw(); }
    if (a === 'addParam') return change(m => { const sec = V.fmTab || 'IMPORTING'; if (sec === 'EXCEPTIONS') { m.exceptions.push('ERROR'); return; } const pre = { IMPORTING: 'IV_', EXPORTING: 'EV_', CHANGING: 'CV_', TABLES: 'T_' }[sec]; let n = 1; while (m.params.some(p => p.name === `${pre}PARAM${n}`)) n++; m.params.push({ section: sec, name: `${pre}PARAM${n}`, byValue: sec !== 'TABLES', typing: sec === 'TABLES' ? 'STRUCTURE' : 'TYPE', type: sec === 'TABLES' ? '' : 'STRING', default: '', optional: false }); });
    if (a === 'delParam') return change(m => { m.params.splice(Number(d.i), 1); });
    if (a === 'delExc') return change(m => { m.exceptions.splice(Number(d.i), 1); });
  }
  function drawFm() {
    const m = V.model;
    const sec = V.fmTab || 'IMPORTING';
    const rows = m.params.map((p, i) => [p, i]).filter(([p]) => p.section === sec);
    const count = s => (s === 'EXCEPTIONS' ? m.exceptions.length : m.params.filter(p => p.section === s).length);
    const tables = sec === 'TABLES';
    body.innerHTML = `<div class="ve-sec"><div class="ve-grid2"><label>Function module</label><b>${esc(m.name.toUpperCase())}</b></div></div>
      <div class="ve-parts" role="tablist">${FM.SECTIONS.map(s => `<button class="ve-part${s === sec ? ' on' : ''}" role="tab" aria-selected="${s === sec}" data-do="fmTab" data-s="${s}">${s[0]}${s.slice(1).toLowerCase()}${count(s) ? ` (${count(s)})` : ''}</button>`).join('')}</div>
      <div class="ve-sec">${sec === 'EXCEPTIONS' ? `<table class="ve-tab"><tr><th>Exception</th><th></th></tr>${m.exceptions.map((e, i) => `<tr><td>${inp(`exceptions.${i}`, e, 'class="mono w14"')}</td><td class="ve-ops"><button class="x" data-do="delExc" data-i="${i}" title="Remove">✕</button></td></tr>`).join('')}</table>
        <p class="ve-note">RAISE &lt;exception&gt; in the function module; the caller gets sy-subrc from its EXCEPTIONS list.</p>`
      : `<table class="ve-tab"><tr><th>Parameter</th><th>Typing</th><th>Type</th>${tables ? '' : '<th>Default</th>'}<th>Optional</th>${tables ? '' : '<th>Pass by value</th>'}<th></th></tr>
        ${rows.map(([p, i]) => `<tr><td>${inp(`params.${i}.name`, p.name, 'class="mono w12"')}</td><td>${sel(`params.${i}.typing`, p.typing, tables ? ['STRUCTURE', 'LIKE', 'TYPE'] : ['TYPE', 'LIKE', 'TYPE REF TO'])}</td><td>${inp(`params.${i}.type`, p.type, 'class="mono w14" list="veTypes"')}</td>
          ${tables ? '' : `<td>${sec === 'EXPORTING' ? '' : inp(`params.${i}.default`, p.default, 'class="mono w8"')}</td>`}<td>${sec === 'EXPORTING' ? '' : chk(`params.${i}.optional`, p.optional)}</td>${tables ? '' : `<td>${chk(`params.${i}.byValue`, p.byValue)}</td>`}<td class="ve-ops"><button class="x" data-do="delParam" data-i="${i}" title="Remove">✕</button></td></tr>`).join('') || `<tr><td colspan="7" class="ve-note">No ${sec.toLowerCase()} parameters.</td></tr>`}</table>
        <p class="ve-note">${tables ? 'TABLES parameters are internal tables (with header line): STRUCTURE &lt;line type&gt;, or TYPE &lt;table type&gt;.' : 'Types: built-in (STRING, I, C …), data elements, structures, table types; LIKE refers to a table field (ZPO_HEAD-EBELN).'}</p>`}
      <p><button class="btn sm" data-do="addParam">+ ${sec === 'EXCEPTIONS' ? 'Exception' : 'Parameter'}</button></p></div>
      <p class="ve-note">The Design view writes the "Local Interface" comment block of the source; the code stays as written.</p>`;
  }

  // ---------------------------------------------------------------- draw
  function draw() {
    $('.ve-title').textContent = file.split('/').pop();
    $('.ve-kind').textContent = kind === 'table' && V.model?.kind === 'structure' ? 'Structure' : P[2];
    if (V.error) { body.innerHTML = `<div class="ve-sec"><p class="ve-err">${esc(V.error)}</p><p class="ve-note">Fix the source in the Source view, or edit it there.</p></div>`; return; }
    if (kind === 'table') drawTable();
    if (kind === 'view') drawView();
    if (kind === 'bdef') drawBdef();
    if (kind === 'ddlx') drawDdlx();
    if (kind === 'prog') drawProg();
    if (kind === 'doma') drawDoma();
    if (kind === 'dtel') drawDtel();
    if (kind === 'ttyp') drawTtyp();
    if (kind === 'fm') drawFm();
    if (kind === 'sfpi') drawSfpi();
    if (kind === 'msag') drawMsag();
    msg();
  }
  read();
  draw();
  if (kind === 'view' && V.model) loadSource(V.model.source);
  if (kind === 'prog' && V.model) { V.screen = 0; V.sel = -1; V.selC = -1; loadFlow(); }
  return {
    refresh() { if (getText() === V.last) return; read(); draw(); },
    destroy() { document.removeEventListener('keydown', onKey); },
    // before a save / activation: the edit of the focused cell is taken over (change event) and finished
    async flush() {
      const a = document.activeElement;
      if (a && host.contains(a) && /^(INPUT|SELECT|TEXTAREA)$/.test(a.tagName)) { a.dispatchEvent(new Event('change', { bubbles: true })); }
      await new Promise(r => setTimeout(r, 0));
      await V.pending;
    },
  };
}
