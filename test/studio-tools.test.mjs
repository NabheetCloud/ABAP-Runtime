// Studio tooling for classic objects typed in the UI (v0.0.5 Purchase Order scenario): the New Object dialog's
// templates for function modules with an interface, transaction codes, form interfaces and Adobe forms without RAP,
// and the source <-> model functions of the Design views (function module interface, text elements, GUI status,
// screens with a table control, flow logic, domains, data elements, table types, tables with references).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { Workspace, routeWorkspace } from '../src/server/server.js';
import { objectFiles, appContext, KINDS } from '../src/server/generate.js';
import { pdfText } from '../src/classic/client.mjs';
import * as FM from '../src/ui/studio/visual/fm.js';
import * as C from '../src/ui/studio/visual/classic.js';
import * as M from '../src/ui/studio/visual/models.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rap-tools-'));
fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
const open = [];
after(() => { for (const w of open) w.close(); fs.rmSync(dir, { recursive: true, force: true }); });
const ws0 = () => { const w = new Workspace(dir, { dbFile: ':memory:', systemDir: false, lint: false }); open.push(w); return w; };
const write = files => { for (const [f, t] of Object.entries(files)) fs.writeFileSync(path.join(dir, f), t); };
const create = (kind, o) => { const ws = ws0(); const r = objectFiles(kind, o, appContext(ws)); write(r.files); return r; };
const errs = ws => ws.app.diagnostics.errors.map(e => `${e.file}:${e.line} ${e.message}`);

test('the New Object dialog offers every kind of the PO scenario', () => {
  for (const id of ['table', 'stru', 'dtel', 'doma', 'ttyp', 'enqu', 'report', 'modulepool', 'tran', 'fugr', 'sfpi', 'xdpform']) assert.ok(KINDS.some(k => k.id === id), id);
  const doma = KINDS.find(k => k.id === 'doma');
  const types = doma.fields.find(f => f.k === 'datatype').options.map(o => o[0]);
  for (const t of ['CHAR', 'NUMC', 'DEC', 'CURR', 'QUAN', 'UNIT', 'CUKY', 'DATS', 'TIMS', 'INT1', 'INT2', 'INT4', 'INT8', 'STRG', 'RAW', 'FLTP']) assert.ok(types.includes(t), t);
  for (const k of ['decimals', 'sign', 'lowercase', 'valueTable']) assert.ok(doma.fields.some(f => f.k === k), k);
  for (const k of ['short', 'medium', 'long', 'heading']) assert.ok(KINDS.find(x => x.id === 'dtel').fields.some(f => f.k === k), k);
});

test('a function module with its interface typed in the dialog; a second module in the same group; a transaction', () => {
  create('doma', { name: 'ZPO_AMOUNT', datatype: 'CURR', length: 15, decimals: 2 });
  create('dtel', { name: 'ZPO_EBELN', description: 'Purchase order number', datatype: 'CHAR', length: 10 });
  create('stru', { name: 'ZPO_S_HEADER', description: 'PO header', fields: 'ebeln zpo_ebeln\nlifnr char(10)\nnetwr curr(15,2) ref waers\nwaers cuky' });
  create('stru', { name: 'ZPO_S_ITEM', description: 'PO item', fields: 'ebelp numc 5\nmatnr char(18)\nmenge quan(13,3) ref meins\nmeins unit(3)' });
  create('ttyp', { name: 'ZPO_T_ITEM', rowtype: 'ZPO_S_ITEM' });
  const r = create('fugr', { name: 'ZPO_FG', description: 'Purchase orders', fm: 'Z_PO_GET', fmText: 'Read a PO', params: 'importing iv_ebeln type zpo_ebeln\nimporting iv_max type i default 10 optional\nexporting es_header type zpo_s_header\ntables et_items structure zpo_s_item optional\nexceptions not_found' });
  assert.ok(r.files['src/zpo_fg.fugr.lzpo_fgtop.abap'].includes('FUNCTION-POOL zpo_fg.'));
  const src = r.files['src/zpo_fg.fugr.z_po_get.abap'];
  assert.match(src, /\*"\s+REFERENCE\(IV_EBELN\) TYPE  ZPO_EBELN/);
  assert.match(src, /\*"\s+REFERENCE\(IV_MAX\) TYPE  I DEFAULT 10 OPTIONAL/);
  assert.match(src, /\*"\s+ET_ITEMS STRUCTURE  ZPO_S_ITEM OPTIONAL/);
  assert.match(src, /\*"\s+NOT_FOUND/);
  const m = FM.parseFm(src);
  assert.deepEqual(m.params.map(p => `${p.section} ${p.name} ${p.typing} ${p.type}`), ['IMPORTING IV_EBELN TYPE ZPO_EBELN', 'IMPORTING IV_MAX TYPE I', 'EXPORTING ES_HEADER TYPE ZPO_S_HEADER', 'TABLES ET_ITEMS STRUCTURE ZPO_S_ITEM']);
  // the Design view: a changing parameter, an exception; the code after the block stays
  m.params.push({ section: 'CHANGING', name: 'CV_COUNT', typing: 'TYPE', type: 'I', byValue: false, default: '', optional: true });
  m.exceptions.push('LOCKED');
  const body = 'FUNCTION z_po_get.\n*"--\n*"  IMPORTING\n*"     VALUE(X) TYPE  I\n  es_header-ebeln = iv_ebeln.\nENDFUNCTION.\n';
  const out = FM.writeFm(body, m);
  assert.match(out, /\*"  CHANGING\n\*"     REFERENCE\(CV_COUNT\) TYPE  I OPTIONAL/);
  assert.match(out, /\*"      LOCKED\n/);
  assert.match(out, /\n {2}es_header-ebeln = iv_ebeln\.\nENDFUNCTION\.\n$/);
  assert.deepEqual(FM.checkFm({ params: [{ section: 'IMPORTING', name: 'A', type: '' }, { section: 'IMPORTING', name: 'A', type: 'I' }], exceptions: [] }), ['A: no type (generic parameters are not supported here)', 'A: twice']);
  // a second function module in the group: no second TOP include
  const r2 = create('fugr', { name: 'ZPO_FG', fm: 'Z_PO_CREATE', params: 'importing is_header type zpo_s_header\ntables it_items structure zpo_s_item\nexporting ev_ebeln type zpo_ebeln' });
  assert.deepEqual(Object.keys(r2.files), ['src/zpo_fg.fugr.z_po_create.abap']);
  create('report', { name: 'ZPO_LIST', description: 'POs' });
  const tr = create('tran', { name: 'ZPOL', description: 'PO list', program: 'zpo_list' });
  assert.match(tr.files['src/zpol.tran.xml'], /<PGMNA>ZPO_LIST<\/PGMNA>\s*<DYPNO>1000<\/DYPNO>/);
  assert.throws(() => objectFiles('tran', { name: 'ZPOX', program: 'zpo_nothere' }, appContext(ws0())), /Choose the program/);
  const ws = ws0();
  assert.deepEqual(errs(ws), []);
});

test('Adobe form without RAP: a form interface, the starter layout bound to it, sample data in the designer and the preview', async () => {
  const fi = create('sfpi', { name: 'ZPO_FI_PRINT', description: 'PO print', params: 'IS_HEADER TYPE ZPO_S_HEADER\nIT_ITEMS TYPE ZPO_T_ITEM\nIV_TITLE TYPE STRING' });
  assert.deepEqual(JSON.parse(fi.files['src/zpo_fi_print.sfpi.json']).parameters.map(p => p.name), ['IS_HEADER', 'IT_ITEMS', 'IV_TITLE']);
  const f = create('xdpform', { name: 'ZF_PO_PRINT', title: 'Purchase order', source: 'interface', interface: 'ZPO_FI_PRINT' });
  const xdp = f.files['src/zf_po_print.xdp'];
  assert.match(xdp, /ref="\$\.IS_HEADER\.EBELN"/);
  assert.match(xdp, /ref="\$\.IT_ITEMS\.DATA\[\*\]"/);
  assert.match(xdp, /ref="\$\.MATNR"/);
  assert.deepEqual(JSON.parse(f.files['src/zf_po_print.form.json']), { title: 'Purchase order', layout: 'zf_po_print.xdp', interface: 'ZPO_FI_PRINT' });
  // a form with a new interface from the parameters typed in the dialog
  const g = create('xdpform', { name: 'ZF_PO_SHORT', source: 'interface', params: 'IS_HEADER TYPE ZPO_S_HEADER' });
  assert.ok(g.files['src/zpo_short_if.sfpi.json']);
  // the designer's data view and the preview (sample data from the interface's types)
  const ws = ws0();
  assert.deepEqual(errs(ws), []);
  const server = http.createServer((req, res) => { const ch = []; req.on('data', c => ch.push(c)); req.on('end', () => { const body = Buffer.concat(ch).toString(); try { routeWorkspace(ws, req, res, body, new URL(req.url, 'http://x').pathname, ''); } catch (e) { res.writeHead(500); res.end(e.message); } }); });
  await new Promise(r => server.listen(0, r));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const d = await (await fetch(`${base}/api/forms/xdp-design`, { method: 'POST', body: JSON.stringify({ name: 'ZF_PO_PRINT', text: xdp, schema: true }) })).json();
    assert.equal(d.interface, 'ZPO_FI_PRINT');
    assert.match(d.xsd, /name="IS_HEADER"[\s\S]*name="EBELN"/);
    assert.match(d.xsd, /name="IT_ITEMS"[\s\S]*name="DATA" minOccurs="0" maxOccurs="unbounded"/);
    assert.match(d.signature, /is_header\s+= ls_header/);
    const text = [].concat(pdfText(Buffer.from(d.pdf, 'base64'))).join(' ');
    assert.match(text, /MATNR/);                     // sample rows of the table parameter
    assert.match(text, /MATNR 2/);
    const p = await fetch(`${base}/api/forms/preview`, { method: 'POST', body: JSON.stringify({ name: 'ZF_PO_PRINT', text: xdp }) });
    assert.equal(p.status, 200);
    assert.match([].concat(pdfText(Buffer.from(await p.arrayBuffer()))).join(' '), /EBELN/);
  } finally { server.close(); }
});

test('Design view models: text elements, GUI status, screens with a table control, flow logic', () => {
  const xml = fs.readFileSync(new URL('../examples/classic/src/zcflight_maint.prog.xml', import.meta.url), 'utf8');
  // text elements: title, a text symbol, a selection text (8 blanks), a list heading
  const t = C.parseTpool(xml);
  t.symbols.push({ key: '001', text: 'Purchase order', length: 30 });
  t.selections.push({ key: 'P_EBELN', text: 'PO number' });
  t.headings.push({ key: '001', text: 'PO         Vendor' });
  const x1 = C.writeTpool(xml, t);
  assert.match(x1, /<ID>I<\/ID>\s*<KEY>001<\/KEY>\s*<ENTRY>Purchase order<\/ENTRY>\s*<LENGTH>30<\/LENGTH>/);
  assert.match(x1, /<ID>S<\/ID>\s*<KEY>P_EBELN<\/KEY>\s*<ENTRY> {8}PO number<\/ENTRY>/);
  assert.deepEqual(C.parseTpool(x1).selections, [{ key: 'P_EBELN', text: 'PO number', ddic: false }]);
  assert.deepEqual(C.selectionNames('PARAMETERS p_ebeln TYPE zpo_ebeln.\nSELECT-OPTIONS s_lifnr FOR zpo_head-lifnr.'), ['P_EBELN', 'S_LIFNR']);
  assert.equal(C.selectionType('SELECT-OPTIONS s_lifnr FOR zpo_head-lifnr.', 'S_LIFNR'), 'zpo_head-lifnr');
  assert.deepEqual(C.textSymbolsUsed("WRITE text-001. WRITE TEXT-a02."), ['001', 'A02']);
  // GUI status: a function with an icon on the toolbar and a function key, a menu, a title
  const cua = C.parseCua(xml);
  cua.functions.push({ code: 'RELEASE', text: 'Release', icon: 'ICON_RELEASE', iconText: 'Release', exit: false });
  cua.statuses[0].toolbar.push('-', 'RELEASE');
  cua.menus.push({ text: 'Purchase order', items: ['SAVE', '-', 'RELEASE'] });
  cua.titles.push({ code: 'T200', text: 'Items' });
  const x2 = C.writeCua(xml, cua);
  const back = C.parseCua(x2);
  assert.deepEqual(back.statuses[0].toolbar, ['SHOW', 'SAVE', '-', 'RELEASE']);
  assert.ok(Object.values(back.statuses[0].keys).includes('RELEASE'));      // a free key for the toolbar button
  assert.deepEqual(back.menus[0].items, ['SAVE', '-', 'RELEASE']);
  assert.equal(back.functions.find(f => f.code === 'RELEASE').icon, 'ICON_RELEASE');
  assert.ok(back.titles.some(x => x.code === 'T200'));
  // screens: a table control over a structure, a push button, a checkbox; containers round-trip
  const sc = C.parseScreens(xml);
  const tc = C.tableControl({ name: 'TC_ITEMS', line: 6, column: 1, width: 70, height: 6, wa: 'GS_ITEM', columns: [{ name: 'EBELP', length: 5, format: 'NUMC' }, { name: 'MATNR', length: 18 }] });
  sc.screens[0].containers.push(tc.container);
  sc.screens[0].fields.push(...tc.fields, { type: 'PUSH', name: 'BTN_REL', text: 'Release', line: 5, column: 1, length: 10, height: 1, format: 'CHAR', fcode: 'RELEASE', contType: 'SCREEN', contName: 'SCREEN', other: [] },
    { type: 'CHECK', name: 'GV_URGENT', text: 'Urgent', line: 5, column: 20, length: 12, height: 1, format: 'CHAR', input: true, output: true, contType: 'SCREEN', contName: 'SCREEN', other: [] });
  const x3 = C.writeScreens(xml, sc);
  assert.match(x3, /<TYPE>TABLE_CTRL<\/TYPE>\s*<NAME>TC_ITEMS<\/NAME>\s*<ELEMENT_OF>SCREEN<\/ELEMENT_OF>/);
  assert.match(x3, /<CONT_TYPE>TABLE_CTRL<\/CONT_TYPE>\s*<CONT_NAME>TC_ITEMS<\/CONT_NAME>\s*<TYPE>TEMPLATE<\/TYPE>\s*<NAME>GS_ITEM-MATNR<\/NAME>/);
  assert.match(x3, /<TYPE>PUSH<\/TYPE>[\s\S]*?<PUSH_FCODE>RELEASE<\/PUSH_FCODE>/);
  const sc2 = C.parseScreens(x3);
  assert.equal(sc2.screens[0].containers.length, 2);
  assert.equal(sc2.screens[0].fields.filter(f => f.contName === 'TC_ITEMS').length, 4);
  // flow logic: the loops of the table control, the modules the program lacks
  const code = C.tableControlCode({ name: 'TC_ITEMS', table: 'GT_ITEMS', wa: 'GS_ITEM', lineType: 'zpo_s_item', screen: '0100' });
  let flow = C.addToFlow('PROCESS BEFORE OUTPUT.\n  MODULE status_0100.\n\nPROCESS AFTER INPUT.\n  MODULE exit_0100 AT EXIT-COMMAND.\n  MODULE user_command_0100.\n', 'pbo', code.pbo);
  flow = C.addToFlow(flow, 'pai', code.pai, 'start');
  // the rows are taken over before the module that handles the function code (re-test NEW-m3)
  assert.match(flow, /MODULE exit_0100 AT EXIT-COMMAND\.\n {2}LOOP AT gt_items\.\n {4}MODULE modify_tc_items\.\n {2}ENDLOOP\.\n {2}MODULE user_command_0100\./);
  assert.match(code.modules, /tc_items-lines = lines\( gt_items \) \+ 10\./);
  assert.match(code.modules, /IF tc_items-current_line > lines\( gt_items \)\.[\s\S]*APPEND gs_item TO gt_items\./);
  flow = C.addToFlow(flow, 'pai', C.FLOW_TEMPLATES.find(x => x[0] === 'chain')[3]('check_vendor'));
  flow = C.addToFlow(flow, 'pov', C.FLOW_TEMPLATES.find(x => x[0] === 'pov')[3]('f4_vendor'));
  assert.match(flow, /PROCESS BEFORE OUTPUT\.\n {2}MODULE status_0100\.\n {2}MODULE tc_items_lines\.\n {2}LOOP AT gt_items INTO gs_item WITH CONTROL tc_items/);
  assert.match(flow, /PROCESS AFTER INPUT\.[\s\S]*LOOP AT gt_items\.\n {4}MODULE modify_tc_items\.\n {2}ENDLOOP\.[\s\S]*CHAIN\./);
  assert.match(flow, /PROCESS ON VALUE-REQUEST\.\n {2}FIELD gv_field MODULE f4_vendor\./);
  assert.deepEqual(C.missingModules(flow, `PROGRAM x.\n${code.decl}MODULE status_0100 OUTPUT.\nENDMODULE.\n${code.modules}`).map(m => `${m.name} ${m.kind}`), ['exit_0100 input', 'user_command_0100 input', 'check_vendor input', 'f4_vendor input']);
});

test('Design view models: domains, data elements, table types, tables and structures', () => {
  const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'rap-tools2-'));
  try {
    const ctx = { exists: () => false, ddic: { domains: new Map([['zpo_status', {}]]), dataElements: new Map(), tableTypes: new Map() }, tables: [], structures: [] };
    const doma = objectFiles('doma', { name: 'ZPO_STATUS', datatype: 'CHAR', length: 1, values: 'N New' }, ctx).files['src/zpo_status.doma.xml'];
    const d = C.parseDomaXml(doma);
    d.fixed.push({ low: 'R', high: '', text: 'Released' });
    d.datatype = 'NUMC'; d.length = 2; d.text = 'Status';
    const d2 = C.parseDomaXml(C.writeDomaXml(doma, d));
    assert.deepEqual(d2.fixed.map(v => v.low), ['N', 'R']);
    assert.equal(d2.datatype, 'NUMC');
    const dtel = objectFiles('dtel', { name: 'ZPO_STAT', description: 'Purchase order status', domain: 'ZPO_STATUS' }, ctx).files['src/zpo_stat.dtel.xml'];
    const e = C.parseDtelXml(dtel);
    assert.equal(e.short, 'Purchase');                                   // whole words, not cut
    assert.equal(e.medium, 'Purchase order');
    e.domain = ''; e.datatype = 'CHAR'; e.length = 1; e.short = 'Status';
    const e2 = C.parseDtelXml(C.writeDtelXml(dtel, e));
    assert.equal(e2.domain, ''); assert.equal(e2.datatype, 'CHAR'); assert.equal(e2.short, 'Status');
    assert.doesNotMatch(C.writeDtelXml(dtel, e), /REFKIND/);
    const tt = objectFiles('ttyp', { name: 'ZPO_T_X', rowtype: 'char(10)' }, ctx).files['src/zpo_t_x.ttyp.xml'];
    assert.match(tt, /<DATATYPE>CHAR<\/DATATYPE>\s*<LENG>000010<\/LENG>/);
    const ty = C.parseTtypXml(tt);
    ty.access = 'S';
    assert.match(C.writeTtypXml(tt, ty), /<ACCESSMODE>S<\/ACCESSMODE>/);
    // a table: the foreign key stays out of the type, references and the check table are edited
    const t = M.parseTable("define table zpo_item {\n  key client : abap.clnt not null;\n  key ebeln : zpo_ebeln not null with foreign key [0..*,1] zpo_head where client = zpo_item.client and ebeln = zpo_item.ebeln;\n  netpr : abap.curr(15,2);\n  waers : abap.cuky;\n  include zpo_s_admin with suffix _a;\n}\n");
    assert.equal(t.fields[1].type, 'zpo_ebeln');
    assert.equal(t.fields[1].notNull, true);
    assert.equal(M.checkTableOf(t.fields[1]), 'zpo_head');
    assert.deepEqual(t.fields[4], { include: 'zpo_s_admin', suffix: '_a', anns: {} });
    assert.deepEqual(M.checkTable(t), ['netpr: an amount needs its currency key field (Reference)']);
    t.fields[2].anns[M.REF_ANNS[0]] = 'zpo_item.waers';
    assert.deepEqual(M.checkTable(t), []);
    const out = M.writeTable(t);
    assert.match(out, /@Semantics\.amount\.currencyCode : 'zpo_item\.waers'\n {2}netpr/);
    assert.match(out, /include zpo_s_admin with suffix _a;/);
    assert.deepEqual(M.parseTable(out), t);
    const st = M.parseTable("define structure zpo_s_x {\n  a : abap.char(1);\n}\n");
    assert.equal(st.kind, 'structure');
    assert.match(M.writeTable(st), /^define structure zpo_s_x \{/);
  } finally { fs.rmSync(dir2, { recursive: true, force: true }); }
});

test('a save followed by Activate is activated once (the file watcher sees the same sources)', () => {
  const ws = ws0();
  assert.equal(ws.sourceState(), ws.activatedState);
  fs.writeFileSync(path.join(dir, 'src', 'zpo_watch.prog.abap'), 'REPORT zpo_watch.\n');
  assert.notEqual(ws.sourceState(), ws.activatedState);       // the watcher would activate
  ws.activate();
  assert.equal(ws.sourceState(), ws.activatedState);          // after an explicit Activate it does not again
  fs.rmSync(path.join(dir, 'src', 'zpo_watch.prog.abap'));
});

test('a blank app: created with a title and its kind; the New Object dialog defaults follow the kind', async () => {
  const { Studio } = await import('../src/studio/studio.js');
  const sys = fs.mkdtempSync(path.join(os.tmpdir(), 'rap-blank-'));
  try {
    if (!Studio) return;
    const st = new Studio(sys, { port: 0 });
    const r = st.create({ name: 'po-blank', title: 'Purchase orders', flavor: 'classic' });
    const meta = JSON.parse(fs.readFileSync(path.join(sys, r.name, '.rap', 'app.json'), 'utf8'));
    assert.equal(meta.title, 'Purchase orders');
    assert.equal(meta.flavor, 'classic');
    const w = new Workspace(path.join(sys, r.name), { dbFile: ':memory:', systemDir: false, lint: false });
    open.push(w);
    assert.equal(appContext(w).flavor, 'classic');
  } finally { fs.rmSync(sys, { recursive: true, force: true }); }
});

const skipClassic = !(await import('../src/classic/build.mjs')).classicAvailable() ? 'classic engine not installed' : /^pglite|^postgres/.test(process.env.RAP_DB || '') ? 'the classic engine uses SQLite' : false;
test('screen painter tabstrip: tabs with subscreens, CONTROLS TYPE TABSTRIP and the tab function codes run on the classic engine', { skip: skipClassic, timeout: 180000 }, async () => {
  const { runTransaction } = await import('../src/classic/client.mjs');
  const app = fs.mkdtempSync(path.join(os.tmpdir(), 'rap-tabs-'));
  fs.mkdirSync(path.join(app, 'src'));
  let w;
  try {
    const r = objectFiles('modulepool', { name: 'ZPO_TABS', description: 'Tabs', tcode: 'ZPOT' }, { exists: () => false });
    for (const [f, t] of Object.entries(r.files)) fs.writeFileSync(path.join(app, f), t);
    const xmlFile = path.join(app, 'src/zpo_tabs.prog.xml'), flowFile = path.join(app, 'src/zpo_tabs.prog.screen_0100.abap'), srcFile = path.join(app, 'src/zpo_tabs.prog.abap');
    const sc = C.parseScreens(fs.readFileSync(xmlFile, 'utf8'));
    const ts = C.tabstrip({ name: 'TS_PO', line: 4, column: 1, width: 60, height: 6, tabs: ['Header', 'Items'], screens: ['0110', '0120'] });
    sc.screens[0].containers.push(ts.container, ts.area);
    sc.screens[0].fields.push(...ts.fields);
    sc.screens.push(...ts.subscreens);
    fs.writeFileSync(xmlFile, C.writeScreens(fs.readFileSync(xmlFile, 'utf8'), sc));
    const code = C.tabstripCode({ name: 'TS_PO', tabs: ['Header', 'Items'], screens: ['0110', '0120'] });
    fs.writeFileSync(flowFile, C.addToFlow(C.addToFlow(fs.readFileSync(flowFile, 'utf8'), 'pbo', code.pbo), 'pai', code.pai, 'start'));
    for (const n of ['0110', '0120']) fs.writeFileSync(path.join(app, `src/zpo_tabs.prog.screen_${n}.abap`), 'PROCESS BEFORE OUTPUT.\n\nPROCESS AFTER INPUT.\n');
    const src = fs.readFileSync(srcFile, 'utf8');
    fs.writeFileSync(srcFile, src.replace(/^(PROGRAM zpo_tabs\.\n)/, `$1\n${code.decl}`) + code.modules);
    w = new Workspace(app, { systemDir: false, lint: false });
    const st = await w.classic.ensure();
    assert.equal(st.state, 'running', JSON.stringify(st.diagnostics));
    const base = st.url.replace('localhost', '127.0.0.1');
    // a tab is a button of the strip: TAB:<tab>|<function code>
    const s = await runTransaction(base, 'ZPOT', [{ action: 'TAB:TS_PO_T2|TS_PO_T2' }, { action: 'TAB:TS_PO_T1|TS_PO_T1' }]);
    const text = x => JSON.stringify(x);
    assert.ok(s.every(x => x.ok), text(s.map(x => x.message)));
    assert.match(s[0].text, /Header: add the fields of this tab/);
    assert.match(s[1].text, /Items: add the fields of this tab/);
    assert.doesNotMatch(s[1].text, /Header: add/);
    assert.equal(s[1].activeTab, 'TS_PO_T2');
    assert.match(s[2].text, /Header: add the fields of this tab/);
  } finally { w?.close(); fs.rmSync(app, { recursive: true, force: true }); }
});

test('form interface with global data and initialization code: the classic engine runs it before the layout is filled', { skip: skipClassic, timeout: 180000 }, async () => {
  const { runProgram } = await import('../src/classic/client.mjs');
  const app = fs.mkdtempSync(path.join(os.tmpdir(), 'rap-fpif-'));
  fs.mkdirSync(path.join(app, 'src'));
  let w;
  const put = files => { for (const [f, t] of Object.entries(files)) fs.writeFileSync(path.join(app, f), t); };
  const make = (kind, o) => { const x = new Workspace(app, { dbFile: ':memory:', systemDir: false, lint: false }); try { const r = objectFiles(kind, o, appContext(x)); put(r.files); return r; } finally { x.close(); } };
  try {
    make('stru', { name: 'ZFI_S_HEAD', fields: 'ebeln char(10)\nlifnr char(10)' });
    make('stru', { name: 'ZFI_S_ITEM', fields: 'matnr char(18)\nmenge dec(13,3)' });
    make('ttyp', { name: 'ZFI_T_ITEM', rowtype: 'ZFI_S_ITEM' });
    const fi = make('sfpi', { name: 'ZFI_PRINT', params: 'IS_HEADER TYPE ZFI_S_HEAD\nIT_ITEMS TYPE ZFI_T_ITEM', global: 'GV_COUNT TYPE I\nGV_TITLE TYPE STRING\nGS_FIRST TYPE ZFI_S_ITEM',
      init: 'gv_count = lines( it_items ).\ngv_title = |PO { is_header-ebeln } with { gv_count } items|.\nREAD TABLE it_items INTO gs_first INDEX 1.' });
    assert.deepEqual(JSON.parse(fi.files['src/zfi_print.sfpi.json']).global.map(g => g.name), ['GV_COUNT', 'GV_TITLE', 'GS_FIRST']);
    const f = make('xdpform', { name: 'ZF_FI', title: 'Order', source: 'interface', interface: 'ZFI_PRINT' });
    assert.match(f.files['src/zf_fi.xdp'], /ref="\$\.GV_TITLE"/);
    assert.match(f.files['src/zf_fi.xdp'], /ref="\$\.GS_FIRST\.MATNR"/);
    put({ 'src/zfi_drive.prog.abap': `REPORT zfi_drive.
DATA ls_out TYPE sfpoutputparams.
DATA ls_doc TYPE sfpdocparams.
DATA ls_form TYPE fpformoutput.
DATA lv_fm TYPE rs38l_fnam.
DATA ls_head TYPE zfi_s_head.
DATA lt_items TYPE zfi_t_item.
START-OF-SELECTION.
  ls_head-ebeln = '4500000077'.
  APPEND VALUE #( matnr = 'BOLT' menge = 3 ) TO lt_items.
  APPEND VALUE #( matnr = 'NUT' menge = 5 ) TO lt_items.
  ls_out-getpdf = 'X'.
  CALL FUNCTION 'FP_JOB_OPEN' CHANGING ie_outputparams = ls_out EXCEPTIONS OTHERS = 1.
  CALL FUNCTION 'FP_FUNCTION_MODULE_NAME' EXPORTING i_name = 'ZF_FI' IMPORTING e_funcname = lv_fm.
  CALL FUNCTION lv_fm EXPORTING /1bcdwb/docparams = ls_doc is_header = ls_head it_items = lt_items IMPORTING /1bcdwb/formoutput = ls_form EXCEPTIONS OTHERS = 1.
  CALL FUNCTION 'FP_JOB_CLOSE' EXCEPTIONS OTHERS = 1.
  WRITE: / |pages { ls_form-pages }|.
`, 'src/zfi_drive.prog.xml': objectFiles('report', { name: 'ZFI_DRIVE', description: 'Drive' }, { exists: () => false }).files['src/zfi_drive.prog.xml'] });
    w = new Workspace(app, { systemDir: false, lint: false });
    assert.deepEqual(w.app.diagnostics.errors, []);
    const st = await w.classic.ensure();
    assert.equal(st.state, 'running', JSON.stringify(st.diagnostics));
    const base = st.url.replace('localhost', '127.0.0.1');
    const r = await runProgram(base, 'ZFI_DRIVE', {}, { pages: true });
    assert.match(r.list, /pages 1/);
    const link = /href="(\/__rap\/preview\/\d+\.pdf)"/.exec(r.html)?.[1];
    assert.ok(link, r.list);
    const text = pdfText(Buffer.from(await (await fetch(`${base}${link.slice(1)}`)).arrayBuffer())).join('|');
    assert.match(text, /PO 4500000077 with 2 items/);
    assert.match(text, /BOLT/);
  } finally { w?.close(); fs.rmSync(app, { recursive: true, force: true }); }
});

test('re-test fixes: foreign key from the check table keys (and checked at activation), class methods, message class, code after ENDFUNCTION, app function modules in the checks, FM test form, XDP captions', async () => {
  const { runAtc } = await import('../src/check/atc.js');
  const { functionPage } = await import('../src/classic/system.mjs');
  const app = fs.mkdtempSync(path.join(os.tmpdir(), 'rap-retest-'));
  fs.mkdirSync(path.join(app, 'src'));
  const put = files => { for (const [f, t] of Object.entries(files)) fs.writeFileSync(path.join(app, f), t); };
  const w0 = () => { const x = new Workspace(app, { dbFile: ':memory:', systemDir: false, lint: false }); open.push(x); return x; };
  const make = (kind, o) => { const r = objectFiles(kind, o, appContext(w0())); put(r.files); return r; };
  try {
    // the check table's key decides the where clause: EBELP is checked against ZPO_HEAD's key EBELN (NEW-m6)
    const item = M.parseTable("define table zpo_item {\n  key client : abap.clnt not null;\n  key ebeln : abap.char(10) not null;\n  key ebelp : abap.numc(5) not null;\n}\n");
    assert.equal(M.foreignKey(item, item.fields[2], 'zpo_head', [{ name: 'client', client: true }, { name: 'ebeln' }]), 'with foreign key [0..*,1] zpo_head where client = zpo_item.client and ebeln = zpo_item.ebelp');
    assert.equal(M.foreignKey(item, item.fields[1], 'zpo_head', [{ name: 'client', client: true }, { name: 'ebeln' }]), 'with foreign key [0..*,1] zpo_head where client = zpo_item.client and ebeln = zpo_item.ebeln');
    make('dtel', { name: 'ZRT_EBELN', description: 'Purchase order number', datatype: 'CHAR', length: 10, medium: 'PO number' });
    make('table', { name: 'ZRT_HEAD', uuidKey: false, admin: false, keys: 'ebeln zrt_ebeln', fields: 'lifnr char(10)' });
    put({ 'src/zrt_item.tabl.cds': "@EndUserText.label : 'Item'\ndefine table zrt_item {\n  key client : abap.clnt not null;\n  key ebeln : zrt_ebeln not null;\n  key ebelp : abap.numc(5) not null\n    with foreign key [0..*,1] zrt_head where client = zrt_item.client and ebelp = zrt_item.ebelp;\n}\n" });
    let e = w0().app.diagnostics.errors.map(x => `${x.file}:${x.line} ${x.message}`);
    assert.ok(e.some(x => /zrt_item\.tabl\.cds:5 Table zrt_item: the foreign key of ebelp compares ebelp, which is not a field of the check table ZRT_HEAD/.test(x)), e.join('\n'));
    put({ 'src/zrt_item.tabl.cds': "@EndUserText.label : 'Item'\ndefine table zrt_item {\n  key client : abap.clnt not null;\n  key ebeln : zrt_ebeln not null\n    with foreign key [0..*,1] zrt_head where client = zrt_item.client and ebeln = zrt_item.ebeln;\n  key ebelp : abap.numc(5) not null;\n}\n" });
    assert.deepEqual(w0().app.diagnostics.errors, []);
    // a class with methods from the dialog (m21): definitions in their sections, empty implementations
    const c = make('class', { name: 'ZCL_RT_SERVICE', classKind: 'plain', methods: JSON.stringify([{ name: 'read', visibility: 'public', params: 'importing iv_ebeln type zrt_ebeln returning value(rv_lifnr) type string' }, { name: 'check', visibility: 'private', static: true, params: 'importing iv_x type i', raising: 'cx_static_check' }]) });
    const cls = c.files['src/zcl_rt_service.clas.abap'];
    assert.match(cls, /PUBLIC SECTION\.\n {4}"! read\n {4}METHODS read IMPORTING iv_ebeln TYPE zrt_ebeln RETURNING VALUE\(rv_lifnr\) TYPE string\./);
    assert.match(cls, /PRIVATE SECTION\.\n {4}"! check\n {4}CLASS-METHODS check IMPORTING iv_x TYPE i RAISING cx_static_check\./);
    assert.match(cls, /METHOD read\.\n {2}ENDMETHOD\.\n {2}METHOD check\.\n {2}ENDMETHOD\./);
    assert.throws(() => objectFiles('class', { name: 'ZCL_RT_BAD', methods: JSON.stringify([{ name: 'x', params: 'returning rv type i' }]) }, {}), /RETURNING needs VALUE/);
    // classic apps: a plain class by default; the message class without sample texts
    assert.equal(KINDS.find(k => k.id === 'class').fields.find(f => f.k === 'classKind').rapDefault, 'plain');
    assert.equal(KINDS.find(k => k.id === 'msag').fields[0].default, undefined);
    // function modules: the app's FMs and lock FMs are no "not found" findings (NEW-M5); code after ENDFUNCTION (NEW-m2)
    make('fugr', { name: 'ZRT_FG', fm: 'ZRT_GET', params: 'importing iv_ebeln type zrt_ebeln\nexporting es_head type zrt_head\ntables et_rows structure zrt_head optional' });
    make('enqu', { name: 'EZRT_HEAD', table: 'zrt_head' });
    put({ 'src/zcl_rt_use.clas.abap': "CLASS zcl_rt_use DEFINITION PUBLIC FINAL CREATE PUBLIC.\n  PUBLIC SECTION.\n    METHODS go.\nENDCLASS.\nCLASS zcl_rt_use IMPLEMENTATION.\n  METHOD go.\n    DATA ls TYPE zrt_head.\n    CALL FUNCTION 'ZRT_GET' EXPORTING iv_ebeln = '1' IMPORTING es_head = ls.\n    CALL FUNCTION 'ENQUEUE_EZRT_HEAD' EXPORTING ebeln = '1' EXCEPTIONS foreign_lock = 1 OTHERS = 2.\n  ENDMETHOD.\nENDCLASS.\n" });
    const atc = runAtc(app);
    assert.deepEqual(atc.findings.filter(f => /Function module/.test(f.message)).map(f => f.message), []);
    fs.appendFileSync(path.join(app, 'src/zrt_fg.fugr.zrt_get.abap'), "  SELECT * FROM zrt_head INTO TABLE @DATA(lt).\n");
    e = w0().app.diagnostics.errors.map(x => `${x.file}:${x.line} ${x.message}`);
    assert.ok(e.some(x => /zrt_fg\.fugr\.zrt_get\.abap:\d+ Statements after ENDFUNCTION/.test(x)), e.join('\n'));
    // FM test page (m12): a structure parameter as component inputs, a table as rows
    const html = functionPage({ app: 'x' }, { name: 'ZRT_GET', group: 'ZRT_FG', sections: { IMPORTING: [{ parameter: 'IS_HEAD', typ: 'ZRT_HEAD', comps: ['EBELN', 'LIFNR'], shape: 'TABL' }], TABLES: [{ parameter: 'IT_ROWS', typ: 'ZRT_HEAD', comps: ['EBELN', 'LIFNR'], table: true, kind: 'STRUCTURE' }] } });
    assert.match(html, /data-param="IS_HEAD" data-kind="struct"[\s\S]*data-c="EBELN"/);
    assert.match(html, /data-param="IT_ROWS" data-kind="table"[\s\S]*<th>LIFNR<\/th>/);
    // XDP captions: the data element's label (NEW-p4)
    make('stru', { name: 'ZRT_S_HEAD', fields: 'ebeln zrt_ebeln\nlifnr char(10)' });
    const f = make('xdpform', { name: 'ZF_RT', source: 'interface', params: 'IS_HEADER TYPE ZRT_S_HEAD' });
    assert.match(f.files['src/zf_rt.xdp'], /<text>PO number<\/text>/);
  } finally { fs.rmSync(app, { recursive: true, force: true }); }
});

test('round 3: T100 exception class, table control with the app\'s table type, declarations after the header comment, flow templates at a line', { timeout: 180000 }, async () => {
  const app = fs.mkdtempSync(path.join(os.tmpdir(), 'rap-r3-'));
  fs.mkdirSync(path.join(app, 'src'));
  const put = files => { for (const [f, t] of Object.entries(files)) fs.writeFileSync(path.join(app, f), t); };
  const w0 = () => { const x = new Workspace(app, { dbFile: ':memory:', systemDir: false, lint: false }); open.push(x); return x; };
  const make = (kind, o) => { const r = objectFiles(kind, o, appContext(w0())); put(r.files); return r; };
  try {
    make('msag', { name: 'ZR3', messages: '001 Purchase order &1 does not exist' });
    const x = make('exception', { name: 'ZCX_R3_ERROR', msgClass: 'ZR3', msgNo: '001', msgAttrs: 'mv_ebeln' });
    assert.match(x.files['src/zcx_r3_error.clas.abap'], /INTERFACES if_t100_dyn_msg\./);
    put({ 'src/zcl_r3_demo.clas.abap': "CLASS zcl_r3_demo DEFINITION PUBLIC FINAL CREATE PUBLIC.\n  PUBLIC SECTION.\n    INTERFACES if_oo_adt_classrun.\nENDCLASS.\nCLASS zcl_r3_demo IMPLEMENTATION.\n  METHOD if_oo_adt_classrun~main.\n    TRY.\n        RAISE EXCEPTION NEW zcx_r3_error( mv_ebeln = '4500000099' ).\n      CATCH zcx_r3_error INTO DATA(lx).\n        out->write( lx->get_text( ) ).\n    ENDTRY.\n  ENDMETHOD.\nENDCLASS.\n" });
    const ws = w0();
    assert.deepEqual(ws.app.diagnostics.errors, []);
    const r = ws.runClass('zcl_r3_demo');
    assert.ok(r.ok, r.error);
    assert.equal(r.output.trim(), 'Purchase order 4500000099 does not exist');
    // the wizard types the internal table with the app's table type when there is one (NEW3-m1)
    const code = C.tableControlCode({ name: 'TC_ITEMS', table: 'GT_ITEMS', wa: 'GS_ITEM', lineType: 'zpo_s_item', screen: '0100', tableType: 'zpo_t_item' });
    assert.match(code.decl, /DATA gt_items TYPE zpo_t_item\./);
    assert.match(C.tableControlCode({ name: 'TC', table: 'GT', wa: 'GS', lineType: 'zs', screen: '0100' }).decl, /TYPE STANDARD TABLE OF zs WITH DEFAULT KEY\./);
    const src = "PROGRAM zpo_maint.\n\n* Maintain purchase orders\n* screen 0100\n\nDATA gv_ok_code TYPE sy-ucomm.\nDATA gs_item TYPE zpo_s_item.\n";
    const out = C.insertDeclarations(src, code.decl);
    assert.match(out, /^PROGRAM zpo_maint\.\n\n\* Maintain purchase orders\n\* screen 0100\n\nCONTROLS tc_items TYPE TABLEVIEW USING SCREEN 0100\.\nDATA gt_items TYPE zpo_t_item\.\n\nDATA gv_ok_code/);
    assert.equal((out.match(/DATA gs_item/g) || []).length, 1);                    // an existing declaration is not repeated
    assert.equal(C.insertAtLine('PROCESS AFTER INPUT.\n  MODULE a.\n  MODULE b.\n', 2, '  FIELD x MODULE y ON REQUEST.'), 'PROCESS AFTER INPUT.\n  MODULE a.\n  FIELD x MODULE y ON REQUEST.\n  MODULE b.\n');
  } finally { fs.rmSync(app, { recursive: true, force: true }); }
});

test('the activation number counts activations of changed sources, not classic builds or repeated activations', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'rap-actno-'));
  fs.cpSync(new URL('../examples/travel', import.meta.url).pathname, d, { recursive: true });
  fs.rmSync(path.join(d, '.rap'), { recursive: true, force: true });
  const ws = new Workspace(d, { dbFile: ':memory:', systemDir: false, lint: false });
  try {
    const a = ws.summary().activation;
    ws.activate(); ws.activate();
    assert.equal(ws.summary().activation, a, 'same sources: same number');
    ws.version++;   // what a classic build does: refresh the views only
    assert.equal(ws.summary().activation, a);
    const f = path.join(d, 'src', fs.readdirSync(path.join(d, 'src')).find(x => x.endsWith('.ddlx.asddlxs')));
    fs.appendFileSync(f, '\n');
    ws.activate();
    assert.equal(ws.summary().activation, a + 1, 'a change: one more');
  } finally { ws.close(); fs.rmSync(d, { recursive: true, force: true }); }
});
