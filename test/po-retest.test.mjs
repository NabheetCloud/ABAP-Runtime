// The purchase-order app of the v0.0.5 acceptance re-test (test/fixtures/po-retest, the re-tester's sources: ZPO_CREATE
// numbers its items here, ZPO_PRINT uses MOVE-CORRESPONDING itab TO itab again, ZCL_PO_SERVICE calls read( ) without
// me->). Covers the runtime findings of the re-test: conversion errors in the activation result, Problems and Run
// (NEW-B1), the debugger in ZPO_REPORT (NEW-M1), new table-control rows (NEW-M2), MOVE-CORRESPONDING of tables and
// classic runtime errors (NEW-M3), lock function modules on the RAP runtime (NEW-M4), the code checks (NEW-M5), and
// the minors (read( ) as a method call, DATS screen fields, sy-dbcnt per session).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Workspace, routeWorkspace } from '../src/server/server.js';
import { classicAvailable } from '../src/classic/build.mjs';
import { runProgram, runTransaction } from '../src/classic/client.mjs';
import { runAtc } from '../src/check/atc.js';

const skip = !classicAvailable() ? 'classic engine not installed (npm run setup:open-abap)' : /^pglite|^postgres/.test(process.env.RAP_DB || '') ? 'the classic engine uses the SQLite database' : false;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rap-retest-'));
fs.cpSync(new URL('./fixtures/po-retest', import.meta.url).pathname, dir, { recursive: true });
let ws, base;
const extra = [];
after(() => { ws?.close(); for (const w of extra) w.close(); fs.rmSync(dir, { recursive: true, force: true }); });
const waitFor = async (fn, ms = 20000) => { const end = Date.now() + ms; let v; while (!(v = await fn()) && Date.now() < end) await new Promise(r => setTimeout(r, 100)); return v; };
const cell = (c, r, v) => ({ [`gg-cell-TC_ITEMS-${c}-${r}`]: v });
function request(w, method, url) {
  return new Promise(resolve => {
    const res = { status: 0, headers: {}, writeHead(s, h) { this.status = s; Object.assign(this.headers, h || {}); }, setHeader(k, v) { this.headers[k] = v; }, end(b) { resolve({ status: this.status, body: String(b ?? '') }); }, write() {} };
    routeWorkspace(w, { method, url, headers: {} }, res, '', url.split('?')[0], '');
  });
}

test('re-test: activation, the code checks (no false errors for the app\'s and the lock function modules), read( ) as a method call', { skip, timeout: 120000 }, async () => {
  ws = new Workspace(dir, { systemDir: false, lint: true });
  assert.deepEqual(ws.app.diagnostics.errors, []);
  assert.deepEqual(ws.app.diagnostics.warnings.filter(w => /Function module/.test(w.message)), []);
  const atc = runAtc(dir, { knownObjects: ws.knownObjects() });
  assert.deepEqual(atc.findings.filter(f => f.severity === 'error').map(f => `${f.file}:${f.line} ${f.message}`), []);
  const st = await ws.classic.ensure();
  assert.equal(st.state, 'running', JSON.stringify(st.diagnostics));
  assert.deepEqual(st.diagnostics.filter(d => d.severity === 'error' || /debugger/.test(d.message)), []);
  base = st.url.replace('localhost', '127.0.0.1');
});

test('NEW-M2: a new PO in ZPO1 with items typed in the empty table-control rows (below the table\'s lines)', { skip, timeout: 60000 }, async () => {
  const r = await runTransaction(base, 'ZPO1', [{ command: 'SAVE', fields: { 'GS_HEAD-EBELN': '4500000001', 'GS_HEAD-LIFNR': 'V100', 'GS_HEAD-WAERS': 'EUR',
    ...cell('MATNR', 1, 'PUMP-01'), ...cell('MENGE', 1, '2'), ...cell('MEINS', 1, 'PC'), ...cell('NETPR', 1, '100.00'),
    ...cell('MATNR', 2, 'VALVE-07'), ...cell('MENGE', 2, '5'), ...cell('MEINS', 2, 'PC'), ...cell('NETPR', 2, '20.00') } }]);
  assert.match(r[1].message, /Purchase order 4500000001 created/);
  const items = ws.app.db.prepare("SELECT ebelp, matnr, menge FROM zpo_item WHERE ebeln = '4500000001' ORDER BY ebelp").all().map(x => ({ ...x }));
  assert.deepEqual(items, [{ ebelp: '00010', matnr: 'PUMP-01', menge: 2 }, { ebelp: '00020', matnr: 'VALVE-07', menge: 5 }]);   // no copies of the last row
  // Read shows the two items and input-ready empty rows below them (tc_items-lines = lines + 5)
  const s = await runTransaction(base, 'ZPO1', [{ command: 'READ', fields: { 'GS_HEAD-EBELN': '4500000001' } }]);
  assert.ok(s[1].ok, s[1].message);
});

test('NEW-m10: a date screen field is blank when initial (FORMAT CHAR in the painter, type DATS from the structure)', { skip, timeout: 30000 }, async () => {
  const html = await (await fetch(`${base}transaction?tcode=ZPO1`)).text();
  const input = /<input[^>]*name="GS_HEAD-BEDAT"[^>]*>/.exec(html)?.[0] || '';
  assert.match(input, /value=""/);
  assert.match(input, /data-abap-type="D"/);
});

test('NEW-M1: the debugger stops in the re-tester\'s ZPO_REPORT (FORM with FORMAT / CALL FUNCTION in a loop)', { skip, timeout: 120000 }, async () => {
  const REP = 'src/zpo_report.prog.abap';
  const src = fs.readFileSync(path.join(dir, REP), 'utf8').split('\n');
  const write = src.findIndex(l => /WRITE: \/ ls_head-ebeln/.test(l)) + 1, format = src.findIndex(l => /FORMAT COLOR COL_NORMAL/.test(l)) + 1;
  await ws.debugStart({ kind: 'classic', name: 'ZPO_REPORT', breakpoints: [`${REP}:${format}`, `${REP}:${write}`] });
  const run = runProgram(base, 'ZPO_REPORT', { P_ALV: '' });
  const paused = () => waitFor(async () => { const s = await ws.debugState(); return s.status === 'paused' ? s.paused : null; });
  let p = await paused();
  assert.deepEqual([p?.line, p?.stack], [format, ['FORM SHOW_LIST', 'START-OF-SELECTION']]);
  await ws.debugCommand('over');
  p = await paused();
  assert.equal(p?.line, write);
  await ws.debugCommand('stop');
  await run;
});

test('NEW-M3: MOVE-CORRESPONDING itab TO itab in ZPO_PRINT; a classic runtime error has its line and is a runtime error of the app', { skip, timeout: 120000 }, async () => {
  const r = await runProgram(base, 'ZPO_PRINT', { P_EBELN: '4500000001', P_GETPDF: 'X' });
  assert.equal(r.ok, true, r.message || r.list);
  assert.match(r.list, /\d+ page|PDF|bytes/i);
  // a program that dumps: the error page names the statement, Problems -> Runtime errors lists it
  fs.writeFileSync(path.join(dir, 'src', 'zpo_dump.prog.abap'), 'REPORT zpo_dump.\nDATA gv_n TYPE i.\nSTART-OF-SELECTION.\n  PERFORM divide.\nFORM divide.\n  DATA lv_x TYPE i.\n  lv_x = 1 / gv_n.\n  WRITE / lv_x.\nENDFORM.\n');
  fs.writeFileSync(path.join(dir, 'src', 'zpo_dump.prog.xml'), fs.readFileSync(path.join(dir, 'src', 'zpo_report.prog.xml'), 'utf8').replace(/ZPO_REPORT/g, 'ZPO_DUMP').replace(/<TPOOL>[\s\S]*<\/TPOOL>/, ''));
  ws.activate();
  const st = await ws.classic.ensure();
  base = st.url.replace('localhost', '127.0.0.1');
  const d = await runProgram(base, 'ZPO_DUMP', {}, { pages: true });
  assert.equal(d.ok, false);
  assert.match(d.html, /Runtime error at <code>src\/zpo_dump\.prog\.abap:7<\/code> \(FORM DIVIDE\)/);
  const dumps = JSON.parse((await request(ws, 'GET', '/api/dumps')).body);
  const dump = dumps.find(x => /ZPO_DUMP/.test(x.context));
  assert.ok(dump, JSON.stringify(dumps));
  assert.deepEqual([dump.file, dump.line], ['src/zpo_dump.prog.abap', 7]);
  const full = JSON.parse((await request(ws, 'GET', `/api/dumps/${dump.id}`)).body);
  assert.deepEqual(full.frames.map(f => f.method), ['FORM DIVIDE', 'START-OF-SELECTION']);
  assert.ok(full.source.some(l => /1 \/ gv_n/.test(l.text)));
});

test('NEW-M4: the lock function modules on the RAP runtime: a console run of ZCL_PO_SERVICE, and a lock held in ZPO1', { skip, timeout: 60000 }, async () => {
  let r = ws.runClass('zcl_po_service');
  assert.equal(r.ok, true, r.error);
  assert.match(r.output, /PO 4500000001 vendor V100 status N net 300\.00 EUR/);    // read( ) of the class itself
  assert.match(r.output, /Released/);
  assert.match(r.output, /cannot be released in status R/);
  assert.equal(ws.app.db.prepare("SELECT count(*) AS n FROM rap_enqueue WHERE lock_name = 'EZPO_HEAD'").get().n, 0);   // released at the end of the run
  // a transaction of the classic engine holds the lock: the console run gets FOREIGN_LOCK
  ws.app.db.prepare("UPDATE zpo_head SET status = 'N' WHERE ebeln = '4500000001'").run();
  const s = await runTransaction(base, 'ZPO1', [{ command: 'READ', fields: { 'GS_HEAD-EBELN': '4500000001' } }]);
  assert.ok(s[1].ok, s[1].message);
  r = ws.runClass('zcl_po_service');
  assert.match(r.output, /Purchase order 4500000001 is locked by another user/);
});

test('p8: sy-dbcnt in a dialog step is the value of the session\'s own last SQL statement, not another program\'s', { skip, timeout: 60000 }, async () => {
  fs.writeFileSync(path.join(dir, 'src', 'zpo_dbcnt.prog.abap'), 'REPORT zpo_dbcnt.\nSTART-OF-SELECTION.\n  WRITE: / |dbcnt { sy-dbcnt }|.\n');
  fs.writeFileSync(path.join(dir, 'src', 'zpo_dbcnt.prog.xml'), fs.readFileSync(path.join(dir, 'src', 'zpo_report.prog.xml'), 'utf8').replace(/ZPO_REPORT/g, 'ZPO_DBCNT').replace(/<TPOOL>[\s\S]*<\/TPOOL>/, ''));
  ws.activate();
  base = (await ws.classic.ensure()).url.replace('localhost', '127.0.0.1');
  await runProgram(base, 'ZPO_REPORT', { P_ALV: '' });                         // SELECT of 1 row in another session
  assert.match((await runProgram(base, 'ZPO_DBCNT', {})).list, /dbcnt 0/);
});

test('NEW-B1: conversion errors are in the activation result and Problems with file and line; Run shows them; FORMAT COLOR OFF converts', { skip, timeout: 180000 }, async () => {
  const app = fs.mkdtempSync(path.join(os.tmpdir(), 'rap-b1-'));
  fs.mkdirSync(path.join(app, 'src'));
  const xml = n => `<?xml version="1.0" encoding="utf-8"?>\n<abapGit version="v1.0.0" serializer="LCL_OBJECT_PROG" serializer_version="v1.0.0">\n <asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0">\n  <asx:values>\n   <PROGDIR><NAME>${n}</NAME><SUBC>1</SUBC></PROGDIR>\n   <TPOOL><item><ID>R</ID><ENTRY>${n}</ENTRY><LENGTH>10</LENGTH></item></TPOOL>\n  </asx:values>\n </asx:abap>\n</abapGit>\n`;
  fs.writeFileSync(path.join(app, 'src', 'zfmt.prog.abap'), "REPORT zfmt.\nSTART-OF-SELECTION.\n  FORMAT COLOR COL_POSITIVE INTENSIFIED.\n  WRITE / 'green'.\n  FORMAT COLOR OFF INTENSIFIED OFF.\n  WRITE / 'plain'.\n");
  fs.writeFileSync(path.join(app, 'src', 'zfmt.prog.xml'), xml('ZFMT'));
  fs.writeFileSync(path.join(app, 'src', 'zbad.prog.abap'), "REPORT zbad.\nSTART-OF-SELECTION.\n  WRITE / 'a'.\n  PERFORM ('XYZ') IN PROGRAM zbad.\n");
  fs.writeFileSync(path.join(app, 'src', 'zbad.prog.xml'), xml('ZBAD'));
  const w = new Workspace(app, { systemDir: false, lint: false });
  extra.push(w);
  try {
    const sum = JSON.parse((await request(w, 'POST', '/api/activate')).body);
    const err = sum.diagnostics.errors.find(e => e.source === 'classic' && /GGCONV-E401/.test(e.message));
    assert.ok(err, JSON.stringify(sum.diagnostics));
    assert.deepEqual([err.file, err.line], ['src/zbad.prog.abap', 4]);
    assert.ok(!sum.diagnostics.errors.some(e => /zfmt/.test(e.file)), JSON.stringify(sum.diagnostics.errors));
    const b = w.classic.status().url.replace('localhost', '127.0.0.1');
    const fmt = await runProgram(b, 'ZFMT', {}, { pages: true });
    assert.match(fmt.list, /green[\s\S]*plain/);
    assert.match(fmt.html, /gg-color-positive/);
    const bad = await fetch(`${b}program?name=ZBAD`);
    assert.equal(bad.status, 409);
    const text = await bad.text();
    assert.match(text, /ZBAD cannot run on the classic engine/);
    assert.match(text, /src\/zbad\.prog\.abap:4<\/code> GGCONV-E401/);
  } finally { w.close(); fs.rmSync(app, { recursive: true, force: true }); }
});

test('table control from the painter\'s wizard: rows typed into the empty lines are appended (NEW-m3 / NEW-M2)', { skip, timeout: 180000 }, async () => {
  const { objectFiles } = await import('../src/server/generate.js');
  const C = await import('../src/ui/studio/visual/classic.js');
  const files = objectFiles('modulepool', { name: 'ZPO_WIZ', description: 'Wizard', tcode: 'ZPOW' }, { exists: () => false }).files;
  for (const [f, t] of Object.entries(files)) fs.writeFileSync(path.join(dir, f), t);
  const xmlFile = path.join(dir, 'src/zpo_wiz.prog.xml'), flowFile = path.join(dir, 'src/zpo_wiz.prog.screen_0100.abap'), srcFile = path.join(dir, 'src/zpo_wiz.prog.abap');
  const sc = C.parseScreens(fs.readFileSync(xmlFile, 'utf8'));
  const tc = C.tableControl({ name: 'TC_ITEMS', line: 6, column: 1, width: 70, height: 6, wa: 'GS_ITEM', columns: [{ name: 'MATNR', length: 18 }, { name: 'MENGE', length: 13, format: 'QUAN' }] });
  sc.screens[0].containers.push(tc.container);
  sc.screens[0].fields.push(...tc.fields);
  fs.writeFileSync(xmlFile, C.writeScreens(fs.readFileSync(xmlFile, 'utf8'), sc));
  const code = C.tableControlCode({ name: 'TC_ITEMS', table: 'GT_ITEMS', wa: 'GS_ITEM', lineType: 'zpo_s_item', screen: '0100' });
  fs.writeFileSync(flowFile, C.addToFlow(C.addToFlow(fs.readFileSync(flowFile, 'utf8'), 'pbo', code.pbo), 'pai', code.pai, 'start'));
  const src = fs.readFileSync(srcFile, 'utf8').replace(/^(PROGRAM zpo_wiz\.\n)/, `$1\n${code.decl}`)
    .replace(/MESSAGE \|Done\| TYPE 'S'\./, "MESSAGE |{ lines( gt_items ) } item(s): { REDUCE string( INIT s = `` FOR i IN gt_items NEXT s = s && i-matnr && ` ` ) }| TYPE 'S'.");
  fs.writeFileSync(srcFile, src + code.modules);
  ws.activate();
  const st = await ws.classic.ensure();
  assert.equal(st.state, 'running', JSON.stringify(st.diagnostics));
  base = st.url.replace('localhost', '127.0.0.1');
  const r = await runTransaction(base, 'ZPOW', [{ command: 'SHOW', fields: { ...cell('MATNR', 1, 'BOLT'), ...cell('MENGE', 1, '3'), ...cell('MATNR', 2, 'NUT'), ...cell('MENGE', 2, '5') } },
    { command: 'SHOW', fields: { ...cell('MATNR', 3, 'WASHER') } }]);
  assert.match(r[1].message, /^2 item\(s\): BOLT NUT/);
  assert.match(r[2].message, /^3 item\(s\): BOLT NUT WASHER/);                        // the two rows stay, the new one is added
});

test('NEW-m12: value help from the domain\'s fixed values on the selection screen and on a screen field', { skip, timeout: 30000 }, async () => {
  const sel = await (await fetch(`${base}program?name=ZPO_REPORT`)).text();
  const p = /<input[^>]*name="P_STAT"[^>]*list="([^"]+)"/.exec(sel);
  assert.ok(p, 'P_STAT has a value list');
  assert.match(sel, new RegExp(`<datalist id="${p[1]}"><option value="N">New</option><option value="O">Ordered</option><option value="R">Released</option><option value="C">Closed</option></datalist>`));
  const scr = await (await fetch(`${base}transaction?tcode=ZPO1`)).text();
  assert.match(scr, /<input[^>]*name="GS_HEAD-STATUS"[^>]*list="[^"]+-values"/);
  assert.match(scr, /<option value="R">Released<\/option>/);
});

test('m14: dates in the WRITE list and in the ALV grid in the same user format; initial dates blank', { skip, timeout: 120000 }, async () => {
  fs.writeFileSync(path.join(dir, 'src', 'zpo_dates.prog.abap'), `REPORT zpo_dates.
TYPES: BEGIN OF ty_r, name TYPE c LENGTH 5, d TYPE d, END OF ty_r.
DATA gt TYPE STANDARD TABLE OF ty_r WITH DEFAULT KEY.
PARAMETERS p_alv AS CHECKBOX.
START-OF-SELECTION.
  DATA lv_d TYPE d VALUE '20261110'.
  DATA lv_0 TYPE d.
  gt = VALUE #( ( name = 'A' d = '20261110' ) ( name = 'B' ) ).
  IF p_alv = abap_true.
    cl_salv_table=>factory( IMPORTING r_salv_table = DATA(lo) CHANGING t_table = gt ).
    lo->display( ).
  ELSE.
    WRITE: / 'w', lv_d, 'i', lv_0, 'e', |t { lv_d DATE = USER }|.
  ENDIF.
`);
  fs.writeFileSync(path.join(dir, 'src', 'zpo_dates.prog.xml'), fs.readFileSync(path.join(dir, 'src', 'zpo_report.prog.xml'), 'utf8').replace(/ZPO_REPORT/g, 'ZPO_DATES').replace(/<TPOOL>[\s\S]*<\/TPOOL>/, ''));
  ws.activate();
  base = (await ws.classic.ensure()).url.replace('localhost', '127.0.0.1');
  assert.match((await runProgram(base, 'ZPO_DATES', { P_ALV: '' })).list, /w 10\.11\.2026 i e t 10\.11\.2026/);
  const alv = await runProgram(base, 'ZPO_DATES', { P_ALV: 'X' }, { pages: true });
  const cells = [...alv.html.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(m => m[1].replace(/<[^>]+>/g, '').trim());
  assert.deepEqual(cells.slice(0, 4), ['A', '10.11.2026', 'B', '']);
});
