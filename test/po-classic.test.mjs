// Purchase order scenario (ZPO_*), built from the sources of the v0.0.5 audit (test/fixtures/po-classic): domains,
// data elements, tables ZPO_HEAD / ZPO_ITEM, lock object EZPO_HEAD, function group ZPO_FG, report ZPO_REPORT with a
// selection screen, class ZCL_PO_SERVICE + exception class ZCX_PO_ERROR (the New Object template with get_text
// REDEFINITION), module pool ZPO_MAINT (transaction ZPO1: structured screen fields GS_HEAD-*, table control TC_ITEMS,
// OK code, CHAIN ... ON REQUEST) and the Adobe form print program ZPO_PRINT. Each is run headless; then the debugger.
// The types are DDIC structures (define structure): ZPO_S_HEADER, ZPO_S_ITEM, ZPO_S_PO (include ZPO_S_HEADER + the
// items as table type ZPO_T_ITEMS), used by the classes on the RAP runtime and by the programs on the classic engine.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Workspace } from '../src/server/server.js';
import { classicAvailable } from '../src/classic/build.mjs';
import { runProgram, runTransaction, pdfText } from '../src/classic/client.mjs';
import { syntaxCheck } from '../src/check/abaplint.js';

const skip = !classicAvailable() ? 'classic engine not installed (npm run setup:open-abap)' : /^pglite|^postgres/.test(process.env.RAP_DB || '') ? 'the classic engine uses the SQLite database' : false;
const fixture = new URL('./fixtures/po-classic', import.meta.url).pathname;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rap-po-'));
fs.cpSync(fixture, dir, { recursive: true });
let ws, base;
after(() => { ws?.close(); fs.rmSync(dir, { recursive: true, force: true }); });

const items = (...rows) => Object.fromEntries(rows.flatMap((r, i) => Object.entries(r).map(([k, v]) => [`gg-cell-TC_ITEMS-${k}-${i + 1}`, v])));
const waitFor = async (fn, ms = 20000) => { const end = Date.now() + ms; let v; while (!(v = await fn()) && Date.now() < end) await new Promise(r => setTimeout(r, 100)); return v; };
const fm = async (name, params) => (await fetch(`${base}__rap/api/functions/${name}`, { method: 'POST', body: JSON.stringify({ params }) })).json();

test('PO: code checks know the built-in exception classes (no false "cx_static_check not found")', () => {
  const r = syntaxCheck(dir);
  const found = [...r.errors, ...r.warnings].map(w => w.message).filter(m => /cx_static_check|cx_root|zcx_po_error|zif_po_types|Class or type/i.test(m));
  assert.deepEqual(found, []);
});

test('PO: the classes run on the RAP runtime; the exception class of the template (get_text REDEFINITION) is raised and caught', { skip }, () => {
  ws = new Workspace(dir, { systemDir: false, lint: false });
  assert.deepEqual(ws.app.diagnostics.errors, []);
  let r = ws.runClass('zcl_po_service');
  assert.equal(r.ok, true, r.error);
  assert.match(r.output, /Created 4500000002/);
  assert.match(r.output, /PO 4500000002 vendor V200 total 600\.00 EUR, 1 item\(s\)/);
  r = ws.runClass('zcl_po_service');                                       // the PO exists now: ZCX_PO_ERROR
  assert.equal(r.ok, true, r.error);
  assert.match(r.output, /Create: Purchase order 4500000002 already exists/);
});

test('PO: the classic engine builds the app; selection texts from the text pool and the dictionary', { skip, timeout: 120000 }, async () => {
  const st = await ws.classic.ensure();
  assert.equal(st.state, 'running', JSON.stringify(st.diagnostics));
  base = st.url.replace('localhost', '127.0.0.1');
  assert.deepEqual(st.diagnostics.filter(d => /debugger/.test(d.message)), []);
  // every executable statement of the reports, the module pool and the function modules has a hook
  const { statementsOf } = await import('../src/classic/debugmap.mjs');
  const map = JSON.parse(fs.readFileSync(path.join(dir, '.rap', 'classic', 'debug-map.json'), 'utf8'));
  for (const f of ['zpo_report.prog.abap', 'zpo_maint.prog.abap', 'zpo_print.prog.abap', 'zpo_fg.fugr.zpo_create.abap', 'zcl_po_service.clas.abap']) {
    const missing = statementsOf(f, fs.readFileSync(path.join(dir, 'src', f), 'utf8')).filter(x => x.exec && !map.lines[`src/${f}`]?.[x.row]).map(x => `${x.row} ${x.text}`);
    assert.deepEqual(missing, [], f);
  }
  // text symbols TEXT-001/002 and selection texts of the TPOOL; P_NEWPO / P_STAT get their data element's label
  const warned = st.diagnostics.filter(d => /W101/.test(d.message)).map(d => d.message).join('\n');
  for (const n of ['TEXT-001', 'TEXT-002', 'P_ALV', 'S_EBELN', 'P_NEWPO', 'P_STAT']) assert.doesNotMatch(warned, new RegExp(`\\b${n}\\b`));
  const sel = await (await fetch(`${base}program?name=ZPO_REPORT`)).text();
  for (const t of ['Selection', 'Options', 'Show as ALV grid', 'Purchase order numbe', 'PO status']) assert.ok(sel.includes(t), t);
  assert.doesNotMatch(sel, /TEXT-001/);
  // the engine's own name never shows: page titles, menu bar and start page say RAP Studio
  const home = await (await fetch(base)).text();
  for (const [what, html] of [['selection screen', sel], ['start page', home]]) {
    const visible = html.replace(/<script\b[^]*?<\/script>|<style\b[^]*?<\/style>|<!--[^]*?-->/gi, '').replace(/<(?!title)[^>]*>/gi, m => (/aria-label="[^"]*"/i.exec(m) || [''])[0]);
    assert.doesNotMatch(visible, /open-abap/i, what);
  }
});

test('PO: report ZPO_REPORT creates a PO with ZPO_CREATE (TABLES), lists it with ZPO_GET_DETAIL and releases it with the class', { skip, timeout: 60000 }, async () => {
  let r = await runProgram(base, 'ZPO_REPORT', { P_CREATE: 'X', P_NEWPO: '4500000001', P_ALV: '' });
  assert.match(r.list, /Created purchase order 4500000001/);
  assert.match(r.list, /4500000001 V100 .* N 2100\.00 EUR 2/);
  assert.match(r.list, /00010 MAT-1 Laptop 2\.000 PC 900\.00/);
  assert.match(r.list, /4500000002 V200/);                                   // created by the class on the RAP runtime
  r = await runProgram(base, 'ZPO_REPORT', { P_CREATE: 'X', P_NEWPO: '4500000001', P_ALV: '' });
  assert.match(r.list, /Purchase order 4500000001 already exists/);           // EXCEPTIONS already_exists = 2
  r = await runProgram(base, 'ZPO_REPORT', { P_REL: 'X', P_NEWPO: '4500000001', P_ALV: 'X' }, { pages: true });
  assert.match(r.list, /Released 4500000001 status R items 2/);
  // ALV column headings: the data element's medium label (ZPO_EBELN, ZPO_STAT, ZPO_NETWR), else the field name
  const heads = [...r.html.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)].map(m => m[1].replace(/<[^>]+>/g, '').trim());
  assert.deepEqual(heads.slice(0, 6), ['Purchase order numbe', 'LIFNR', 'BEDAT', 'PO status', 'Net value', 'WAERS']);
  r = await runProgram(base, 'ZPO_REPORT', { P_REL: 'X', P_NEWPO: '4599999999', P_ALV: '' });
  assert.match(r.list, /Error:/);                                             // CATCH zcx_po_error
});

test('PO: function module test with TABLES parameters, exceptions and the lock object', { skip, timeout: 60000 }, async () => {
  let r = await fm('ZPO_CREATE', { IS_HEADER: { EBELN: '4500000010', LIFNR: 'V9', WAERS: 'USD' }, IT_ITEMS: [{ MATNR: 'X1', MENGE: 2, NETPR: '5.00' }, { MATNR: 'X2', MENGE: 1, NETPR: '1.50' }] });
  assert.equal(r.subrc, 0, JSON.stringify(r));
  assert.equal(r.exporting.EV_EBELN, '4500000010');
  assert.deepEqual(r.tables.IT_ITEMS.map(x => x.MATNR), ['X1', 'X2']);
  r = await fm('ZPO_CREATE', { IS_HEADER: { EBELN: '4500000011' } });
  assert.deepEqual([r.subrc, r.exception], [3, 'NO_ITEMS']);
  r = await fm('ZPO_GET_DETAIL', { IV_EBELN: '4500000010' });
  assert.equal(r.exporting.ES_HEADER.NETWR, 11.5);
  assert.equal(r.exporting.EV_ITEM_COUNT, 2);
  assert.deepEqual(r.tables.ET_ITEMS.map(x => [x.EBELP, x.MATNR]), [['00010', 'X1'], ['00020', 'X2']]);
  r = await fm('ZPO_GET_DETAIL', { IV_EBELN: '4599999999' });
  assert.deepEqual([r.subrc, r.exception], [1, 'NOT_FOUND']);
  // the test page: JSON rows for the TABLES parameter, with the line's components in the hint
  const page = await (await fetch(`${base}__rap/functions/ZPO_CREATE`)).text();
  assert.match(page, /name="IT_ITEMS"[^>]*placeholder="JSON rows, e\.g\. \[\{&quot;EBELN&quot;/);
  assert.match(page, /name="IS_HEADER"[^>]*placeholder="JSON, e\.g\. \{&quot;/);
  // ENQUEUE_EZPO_HEAD: a PO open in ZPO1 is locked for ZPO_CREATE and for a second ZPO1
  const [, a] = await runTransaction(base, 'ZPO1', [{ command: 'SHOW', fields: { 'GS_HEAD-EBELN': '4500000010' } }]);
  assert.match(a.message, /Purchase order 4500000010 read and locked/);
  const [, b] = await runTransaction(base, 'ZPO1', [{ command: 'SHOW', fields: { 'GS_HEAD-EBELN': '4500000010' } }]);
  assert.match(b.message, /4500000010 is locked by DEVELOPER/);
});

test('PO: module pool ZPO1 transports structured screen fields and table control rows in PAI (read, save, release)', { skip, timeout: 60000 }, async () => {
  let s = await runTransaction(base, 'ZPO1', [{ command: 'SHOW', fields: { 'GS_HEAD-EBELN': '4500000001' } }]);
  assert.match(s[1].message, /Purchase order 4500000001 read and locked/);
  assert.equal(s[1].screen['GS_HEAD-LIFNR'], 'V100');
  assert.equal(s[1].screen['GS_HEAD-STATUS'], 'R');
  // a new PO: header fields and two item rows, SAVE (ZPO_CREATE), RELEASE (ZCL_PO_SERVICE)
  s = await runTransaction(base, 'ZPO1', [
    { command: 'SHOW', fields: { 'GS_HEAD-EBELN': '4500000020' } },
    { command: 'SAVE', fields: { 'GS_HEAD-LIFNR': 'V300', 'GS_HEAD-WAERS': 'EUR', ...items({ MATNR: 'M1', TXZ01: 'Chair', MENGE: '4', MEINS: 'PC', NETPR: '50.00' }, { MATNR: 'M2', MENGE: '1', NETPR: '10' }) } },
    { command: 'RELEASE' }]);
  assert.match(s[1].message, /4500000020 does not exist: enter items and save/);
  assert.match(s[2].message, /Purchase order 4500000020 saved with 2 item\(s\)/);
  assert.equal(s[2].screen['GS_HEAD-STATUS'], 'N');
  assert.match(s[2].screen['GS_HEAD-NETWR'], /^210\.00/);
  assert.match(s[3].message, /Purchase order 4500000020 released/);
  assert.equal(s[3].screen['GS_HEAD-STATUS'], 'R');
  const row = ws.app.db.prepare("SELECT lifnr, status, netwr FROM zpo_head WHERE ebeln = '4500000020'").get();
  assert.deepEqual({ ...row }, { lifnr: 'V300', status: 'R', netwr: 210 });
  // CHAIN. FIELD gs_head-lifnr MODULE check_vendor ON REQUEST: clearing the vendor is an error
  s = await runTransaction(base, 'ZPO1', [{ command: 'SHOW', fields: { 'GS_HEAD-EBELN': '4500000002' } }, { command: 'SHOW', fields: { 'GS_HEAD-LIFNR': '' } }]);
  assert.equal(s[1].screen['GS_HEAD-LIFNR'], 'V200');
  assert.match(s[2].message, /Enter a vendor/);
});

test('PO: Adobe form print program: FP_JOB_OPEN, the form function module, FP_JOB_CLOSE, PDF and the output queue', { skip, timeout: 60000 }, async () => {
  let r = await runProgram(base, 'ZPO_PRINT', { P_EBELN: '4500000001', P_PREV: 'X' }, { pages: true });
  assert.match(r.list, /Form function module \/1BCDWB\/SM\d{8}/);
  const bytes = Number(/PDF with 1 page\(s\), (\d{4,}) bytes/.exec(r.list)?.[1]);   // the PDF reached the program
  assert.ok(bytes, r.list);
  // getpdf = 'X': the page of the run links the returned PDF (not an output request)
  const link = /href="(\/__rap\/preview\/\d+\.pdf)"/.exec(r.html)?.[1];
  assert.ok(link, 'a link to the returned PDF');
  assert.match(r.list, /PDF returned to the program \(getpdf\) Purchase order 4500000001 ZF_PO_PRINT, 1 page\(s\)/);
  const pdf = Buffer.from(await (await fetch(`${base}${link.slice(1)}`)).arrayBuffer());
  assert.equal(pdf.length, bytes);
  assert.match(pdfText(pdf).join('|'), /Laptop/);
  assert.equal(ws.app.db.prepare("SELECT count(*) AS n FROM rap_output WHERE title = 'Purchase order 4500000001'").get().n, 0);
  r = await runProgram(base, 'ZPO_PRINT', { P_EBELN: '4500000001', P_PREV: '' });
  assert.match(r.list, /Sent to the output queue/);
  const out = ws.app.db.prepare("SELECT id FROM rap_output WHERE title = 'Purchase order 4500000001' ORDER BY id DESC").get();
  assert.ok(out, 'the output request');
  const texts = pdfText(Buffer.from(await (await fetch(`${base}__rap/output/${out.id}.pdf`)).arrayBuffer())).join('|');
  assert.match(texts, /4500000001/);
  assert.match(texts, /Laptop/);
  assert.match(texts, /Docking station/);
  r = await runProgram(base, 'ZPO_PRINT', { P_EBELN: '4599999999', P_PREV: 'X' });
  assert.match(r.list, /Purchase order 4599999999 not found/);
});

test('PO debugger: WRITE, WHEN, statements after a multi-line CALL FUNCTION, step into an FM and a method, return, CATCH, PAI module', { skip, timeout: 180000 }, async () => {
  const state = want => waitFor(async () => { const s = await ws.debugState(); return s.status === want ? s : null; });
  const paused = async () => (await state('paused'))?.paused;
  const REP = 'src/zpo_report.prog.abap', MAINT = 'src/zpo_maint.prog.abap';
  // breakpoints: a WRITE in a WHEN branch, the WHEN line itself (bound to its first statement), ULINE, a WRITE after
  // a multi-line CALL FUNCTION, ENDFORM (no statement left in its FORM: not bound, never moved into another block)
  await ws.debugStart({ kind: 'classic', name: 'ZPO_REPORT', breakpoints: [`${REP}:81`, `${REP}:84`, `${REP}:89`, `${REP}:90`] });
  let st = await ws.debugState();
  assert.equal(st.bound[`${REP}:81`], 81);
  assert.equal(st.bound[`${REP}:84`], 85);
  assert.equal(st.bound[`${REP}:89`], 89);
  assert.equal(st.bound[`${REP}:90`], null);
  let run = runProgram(base, 'ZPO_REPORT', { P_CREATE: 'X', P_NEWPO: '4500000030', P_ALV: '' });
  let p = await paused();
  assert.equal(p.file, REP);
  assert.equal(p.line, 81);
  assert.deepEqual(p.stack, ['FORM CREATE_SAMPLE', 'START-OF-SELECTION']);
  assert.deepEqual(p.vars.lv_ebeln, { t: 'text', v: '4500000030', len: 10 });
  assert.ok(!('lv_count' in p.vars) && !('ls_item' in p.vars), Object.keys(p.vars).join());   // only this FORM's locals
  await ws.debugCommand('over');                                              // WRITE -> ULINE (the next statement)
  p = await paused();
  assert.equal(p.line, 89);
  await ws.debugCommand('breakpoints', { breakpoints: [] });
  await ws.debugCommand('continue');
  assert.match((await run).list, /Created purchase order 4500000030/);

  // the WRITE after CALL FUNCTION ZPO_GET_DETAIL (lines 97-106); step into the FM, then return to the caller
  await ws.debugCommand('breakpoints', { breakpoints: [`${REP}:97`] });
  run = runProgram(base, 'ZPO_REPORT', { S_EBELN: '4500000001', P_ALV: '' });
  p = await paused();
  assert.equal(p.line, 97);
  assert.deepEqual(p.stack, ['FORM SHOW_LIST', 'END-OF-SELECTION']);
  await ws.debugCommand('into');
  p = await paused();
  assert.equal(p.file, 'src/zpo_fg.fugr.zpo_get_detail.abap');
  assert.equal(p.line, 14);
  assert.deepEqual(p.stack, ['FUNCTION ZPO_GET_DETAIL', 'FORM SHOW_LIST', 'END-OF-SELECTION']);
  assert.deepEqual(p.vars.iv_ebeln, { t: 'text', v: '4500000001', len: 10 });
  await ws.debugCommand('watches', { watches: [{ expr: 'lines( et_items )' }, { expr: 'strlen( iv_ebeln )' }] });
  await ws.debugCommand('over');
  p = await paused();
  assert.equal(p.line, 15);
  assert.deepEqual(p.watches.map(w => w.value.v), [0, 10]);
  await ws.debugCommand('watches', { watches: [] });
  await ws.debugCommand('out');                                               // Return (F7): the caller's next statement
  p = await paused();
  assert.equal(p.file, REP);
  assert.equal(p.line, 107);
  assert.deepEqual(p.stack, ['FORM SHOW_LIST', 'END-OF-SELECTION']);
  assert.deepEqual(p.vars.lv_count, { t: 'num', v: 2 });
  await ws.debugCommand('over');
  p = await paused();
  assert.equal(p.line, 108);                                                  // LOOP AT gt_items
  await ws.debugCommand('breakpoints', { breakpoints: [] });
  await ws.debugCommand('continue');
  assert.match((await run).list, /4500000001 V100/);

  // step into a method of ZCL_PO_SERVICE from the report, and a breakpoint in a CATCH block
  await ws.debugCommand('breakpoints', { breakpoints: [`${REP}:132`, `${REP}:137`] });
  run = runProgram(base, 'ZPO_REPORT', { P_REL: 'X', P_NEWPO: '4599999999', P_ALV: '' });
  p = await paused();
  assert.equal(p.line, 132);
  await ws.debugCommand('into');
  p = await paused();
  assert.equal(p.file, 'src/zcl_po_service.clas.abap');
  assert.equal(p.line, 61);
  assert.deepEqual(p.stack, ['ZCL_PO_SERVICE->RELEASE', 'FORM RELEASE_WITH_CLASS', 'START-OF-SELECTION']);
  await ws.debugCommand('continue');
  p = await paused();
  assert.equal(p.line, 137);                                                  // WRITE in CATCH zcx_po_error
  await ws.debugCommand('breakpoints', { breakpoints: [] });
  await ws.debugCommand('continue');
  assert.match((await run).list, /Error:/);

  // a PAI module of the module pool: the structured screen field arrived in GS_HEAD; a breakpoint in a CATCH block
  await ws.debugCommand('breakpoints', { breakpoints: [`${MAINT}:51`, `${MAINT}:71`] });
  let tr = runTransaction(base, 'ZPO1', [{ command: 'SHOW', fields: { 'GS_HEAD-EBELN': '4500000077' } }]);
  p = await paused();
  assert.equal(p.file, MAINT);
  assert.equal(p.line, 51);
  assert.equal(p.stack[0], 'MODULE USER_COMMAND_0100');
  assert.equal(p.me.comps.gs_head.comps.ebeln.v, '4500000077');
  assert.equal(p.me.comps.gv_ok_code.v.trim(), 'SHOW');
  await ws.debugCommand('continue');
  p = await paused();
  assert.equal(p.line, 71);                                                   // MESSAGE in CATCH zcx_po_error
  await ws.debugCommand('breakpoints', { breakpoints: [] });
  await ws.debugCommand('continue');
  assert.match((await tr)[1].message, /4500000077 does not exist/);
  // a module of CHAIN ... FIELD ... ON REQUEST is a frame of its own (not called from USER_COMMAND_0100)
  await ws.debugCommand('breakpoints', { breakpoints: [`${MAINT}:41`] });
  tr = runTransaction(base, 'ZPO1', [{ command: 'SHOW', fields: { 'GS_HEAD-EBELN': '4500000001', 'GS_HEAD-LIFNR': 'V7' } }]);
  p = await paused();
  assert.equal(p.line, 41);
  assert.deepEqual(p.stack, ['MODULE CHECK_VENDOR']);
  await ws.debugCommand('breakpoints', { breakpoints: [] });
  await ws.debugCommand('continue');
  await tr;
  await ws.debugCommand('stop');
});

test('PO: a rebuild after an edit keeps the engine on its port (bookmarks and the engine tab keep working)', { skip, timeout: 120000 }, async () => {
  const before = (await ws.classic.ensure()).port;
  fs.appendFileSync(path.join(dir, 'src', 'zpo_report.prog.abap'), '\n* edited\n');
  const st = await ws.classic.ensure();
  assert.equal(st.state, 'running', JSON.stringify(st.diagnostics));
  assert.equal(st.port, before);
  assert.match((await runProgram(base, 'ZPO_REPORT', { S_EBELN: '4500000001', P_ALV: '' })).list, /4500000001 V100/);
});

test('debugger: a tabstrip module pool is instrumented without warnings; breakpoints in its PBO and PAI modules stop', { skip, timeout: 180000 }, async () => {
  const { objectFiles } = await import('../src/server/generate.js');
  const C = await import('../src/ui/studio/visual/classic.js');
  const app = fs.mkdtempSync(path.join(os.tmpdir(), 'rap-po-tabs-'));
  fs.mkdirSync(path.join(app, 'src'));
  let w;
  try {
    for (const [f, t] of Object.entries(objectFiles('modulepool', { name: 'ZPO_TABS', description: 'Tabs', tcode: 'ZPOT' }, { exists: () => false }).files)) fs.writeFileSync(path.join(app, f), t);
    const xml = path.join(app, 'src/zpo_tabs.prog.xml'), flow = path.join(app, 'src/zpo_tabs.prog.screen_0100.abap'), prog = path.join(app, 'src/zpo_tabs.prog.abap');
    const sc = C.parseScreens(fs.readFileSync(xml, 'utf8'));
    const ts = C.tabstrip({ name: 'TS_PO', line: 4, column: 1, width: 60, height: 6, tabs: ['Header', 'Items'], screens: ['0110', '0120'] });
    sc.screens[0].containers.push(ts.container, ts.area);
    sc.screens[0].fields.push(...ts.fields);
    sc.screens.push(...ts.subscreens);
    fs.writeFileSync(xml, C.writeScreens(fs.readFileSync(xml, 'utf8'), sc));
    const code = C.tabstripCode({ name: 'TS_PO', tabs: ['Header', 'Items'], screens: ['0110', '0120'] });
    fs.writeFileSync(flow, C.addToFlow(C.addToFlow(fs.readFileSync(flow, 'utf8'), 'pbo', code.pbo), 'pai', code.pai, 'start'));
    for (const n of ['0110', '0120']) fs.writeFileSync(path.join(app, `src/zpo_tabs.prog.screen_${n}.abap`), 'PROCESS BEFORE OUTPUT.\n\nPROCESS AFTER INPUT.\n');
    fs.writeFileSync(prog, fs.readFileSync(prog, 'utf8').replace(/^(PROGRAM zpo_tabs\.\n)/, `$1\n${code.decl}`) + code.modules);
    w = new Workspace(app, { systemDir: false, lint: false });
    const st = await w.classic.ensure();
    assert.equal(st.state, 'running', JSON.stringify(st.diagnostics));
    assert.deepEqual(st.diagnostics.filter(d => /debugger/.test(d.message)).map(d => d.message), []);
    const tbase = st.url.replace('localhost', '127.0.0.1');
    const src = fs.readFileSync(prog, 'utf8').split('\n');
    const line = re => src.findIndex(l => re.test(l)) + 1;
    const pbo = line(/ts_po-activetab = 'TS_PO_T1'\./), pai = line(/gv_ts_po_dynnr = '0120'\./);
    const paused = () => waitFor(async () => { const s = await w.debugState(); return s.status === 'paused' ? s.paused : null; });
    await w.debugStart({ kind: 'classic', name: 'ZPO_TABS', breakpoints: [`src/zpo_tabs.prog.abap:${pbo}`, `src/zpo_tabs.prog.abap:${pai}`] });
    const run = runTransaction(tbase, 'ZPOT', [{ action: 'TAB:TS_PO_T2|TS_PO_T2' }]);
    let p = await paused();
    assert.deepEqual([p?.line, p?.stack], [pbo, ['MODULE TS_PO_INIT']]);
    await w.debugCommand('continue');
    p = await waitFor(async () => { const s = await w.debugState(); return s.status === 'paused' && s.paused.line !== pbo ? s.paused : null; });
    assert.deepEqual([p?.line, p?.stack], [pai, ['MODULE TS_PO_TABS']]);
    await w.debugCommand('breakpoints', { breakpoints: [] });
    await w.debugCommand('continue');
    const s = await run;
    assert.equal(s[1].activeTab, 'TS_PO_T2');
    await w.debugCommand('stop');
  } finally { w?.close(); fs.rmSync(app, { recursive: true, force: true }); }
});
