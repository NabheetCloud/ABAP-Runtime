// Classic ABAP engine (open-abap): a report converted, transpiled and served in the RAP Studio look,
// reading the same database as the RAP runtime. Skipped when the engine is not installed (npm run setup:open-abap).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Workspace } from '../src/server/server.js';
import { classicAvailable } from '../src/classic/build.mjs';

const skip = !classicAvailable() ? 'classic engine not installed (npm run setup:open-abap)' : /^pglite|^postgres/.test(process.env.RAP_DB || '') ? 'the classic engine uses the SQLite database' : false;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rap-classic-'));
fs.cpSync(new URL('../examples/classic', import.meta.url).pathname, dir, { recursive: true, filter: f => !f.includes(`${path.sep}.rap`) });
// a driver program with two forms in one job: one output request (queue, copies, title), e_result-spoolids
fs.writeFileSync(path.join(dir, 'src', 'zcflight_spool.prog.abap'), `REPORT zcflight_spool.
DATA ls_outputparams TYPE sfpoutputparams.
DATA ls_docparams TYPE sfpdocparams.
DATA ls_formoutput TYPE fpformoutput.
DATA ls_result TYPE sfpjoboutput.
DATA lv_fm_name TYPE rs38l_fnam.
PARAMETERS p_dest TYPE c LENGTH 4 DEFAULT 'LBL1'.
START-OF-SELECTION.
  ls_outputparams-dest = p_dest.
  ls_outputparams-copies = 2.
  ls_outputparams-covtitle = 'Flight cards'.
  CALL FUNCTION 'FP_JOB_OPEN' CHANGING ie_outputparams = ls_outputparams EXCEPTIONS OTHERS = 1.
  CALL FUNCTION 'FP_FUNCTION_MODULE_NAME' EXPORTING i_name = 'ZCFL_FLIGHT_CARD' IMPORTING e_funcname = lv_fm_name.
  SELECT * FROM zcflight_a ORDER BY carrier_id, connection_id INTO TABLE @DATA(lt_flights).
  LOOP AT lt_flights INTO DATA(ls_flight).
    CALL FUNCTION lv_fm_name EXPORTING /1bcdwb/docparams = ls_docparams is_flight = ls_flight IMPORTING /1bcdwb/formoutput = ls_formoutput EXCEPTIONS OTHERS = 1.
  ENDLOOP.
  CALL FUNCTION 'FP_JOB_CLOSE' IMPORTING e_result = ls_result EXCEPTIONS OTHERS = 1.
  WRITE: / |Requests { lines( ls_result-spoolids ) }|.
  LOOP AT ls_result-spoolids INTO DATA(lv_id).
    WRITE: / |Request { lv_id }|.
  ENDLOOP.
`);
fs.writeFileSync(path.join(dir, 'src', 'zcflight_spool.prog.xml'), fs.readFileSync(path.join(dir, 'src', 'zcflight_print.prog.xml'), 'utf8').replace(/ZCFLIGHT_PRINT/g, 'ZCFLIGHT_SPOOL').replace('Print the flight list form', 'Flight cards in one job').replace(/<item><ID>S<\/ID>.*<\/item>\n?/, ''));
let ws;
const sys = fs.mkdtempSync(path.join(os.tmpdir(), 'rap-classic-sys-'));
const open = [];
after(() => { ws?.close(); for (const w of open) w.close(); fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(sys, { recursive: true, force: true }); });

const plain = h => h.replace(/<(style|script)[\s\S]*?<\/\1>/g, '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');
const field = (html, n) => new RegExp(`name="${n}" value="([^"]*)"`).exec(html)?.[1] ?? '';

// runs a report with selection values and returns the list as plain text
async function runReport(base, name = 'ZCFLIGHT_REPORT', values = { P_CARR: 'LH' }) {
  const sel = await fetch(`${base}program?name=${name}`);
  const cookie = sel.headers.get('set-cookie')?.split(';')[0] || '';
  const html = await sel.text();
  const form = new URLSearchParams({ session_id: field(html, 'session_id'), page_id: field(html, 'page_id'), gg_action: 'SUBMIT', ...values, gg_ucomm: 'ONLI' });
  return plain(await (await fetch(`${base}dispatch`, { method: 'POST', body: form, headers: { 'content-type': 'application/x-www-form-urlencoded', cookie } })).text());
}

// a transaction session: start it, then send function codes with screen field values
async function transaction(base, tcode) {
  const r = await fetch(`${base}transaction?tcode=${tcode}`);
  const s = { cookie: r.headers.get('set-cookie')?.split(';')[0] || '', html: await r.text() };
  s.command = async (code, fields) => {
    const body = new URLSearchParams({ session_id: field(s.html, 'session_id'), page_id: field(s.html, 'page_id'), action: 'SUBMIT', gg_action: `COMMAND:${code}`, ...fields });
    s.html = await (await fetch(`${base}dispatch`, { method: 'POST', body, headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: s.cookie } })).text();
    return plain(s.html);
  };
  return s;
}
const waitFor = async (fn, ms = 15000) => { const end = Date.now() + ms; let v; while (!(v = await fn()) && Date.now() < end) await new Promise(r => setTimeout(r, 200)); return v; };

test('a report runs on the classic engine with the RAP app\'s data, in the new look', { skip, timeout: 120000 }, async () => {
  ws = new Workspace(dir, { systemDir: false, lint: false });
  assert.deepEqual(ws.app.diagnostics.errors, []);                       // the report does not disturb RAP activation
  const st = await ws.classic.ensure();
  assert.equal(st.state, 'running', JSON.stringify(st.diagnostics));
  assert.deepEqual(st.list.map(p => p.name), ['ZCFLIGHT_ADOBE', 'ZCFLIGHT_BATCH', 'ZCFLIGHT_FM', 'ZCFLIGHT_MAINT', 'ZCFLIGHT_PRINT', 'ZCFLIGHT_REPORT', 'ZCFLIGHT_SPOOL']);
  assert.equal(st.list.find(p => p.name === 'ZCFLIGHT_MAINT').tcode, 'ZCFL');
  const base = st.url.replace('localhost', '127.0.0.1');

  const launcher = await (await fetch(base)).text();
  assert.match(launcher, /Flights by carrier/);
  assert.match(launcher, /\/__rap\/theme\.css/);

  const sel = await (await fetch(`${base}program?name=ZCFLIGHT_REPORT`)).text();
  assert.match(sel, /name="P_CARR"[^>]*value="LH"/);
  assert.match(sel, /theme\.js/);
  const list = await runReport(base);
  assert.match(list, /0400 Frankfurt/);
  assert.match(list, /0401 New York/);
  assert.doesNotMatch(list, /0017/);                                     // AA is filtered out by the parameter
});

test('module pool: transaction with dynpro fields, database update and a lock object', { skip, timeout: 60000 }, async () => {
  const base = (await ws.classic.ensure()).url.replace('localhost', '127.0.0.1');
  const a = await transaction(base, 'ZCFL'), b = await transaction(base, 'ZCFL');
  const key = { GV_CARRIER: 'LH', GV_CONNECTION: '0401', GV_PRICE: '0' };
  assert.match(await a.command('SHOW', key), /Flight LH 0401 found/);
  assert.match(a.html, /name="GV_PRICE"[^>]*value="650\.00/);                  // PBO shows the record
  assert.match(await b.command('SHOW', key), /Flight LH 0401 is locked by user DEVELOPER/);   // ENQUEUE_EZCFLIGHT
  assert.match(await a.command('SAVE', { ...key, GV_PRICE: '699.00' }), /Price of LH 0401 saved/);
  assert.match(await b.command('SHOW', key), /Flight LH 0401 found/);            // DEQUEUE released the lock
  assert.match(b.html, /name="GV_PRICE"[^>]*value="699\.00/);                  // committed at the end of the dialog step
  assert.match(await b.command('SAVE', { ...key, GV_PRICE: '650.00' }), /saved/);
});

test('function group, data element with domain fixed values, table type and XCO', { skip, timeout: 60000 }, async () => {
  const base = (await ws.classic.ensure()).url.replace('localhost', '127.0.0.1');
  assert.match(await runReport(base, 'ZCFLIGHT_FM', { P_CARR: 'LH' }), /Airline LH Lufthansa Flights 2 Total 1250\.00 XCO LUFTHANSA/);
  assert.match(await runReport(base, 'ZCFLIGHT_FM', { P_CARR: 'UA' }), /No flights for UA/);   // EXCEPTIONS not_found
});

test('from a class: CALL FUNCTION, SUBMIT ... EXPORTING LIST TO MEMORY, CALL TRANSACTION ... USING (batch input)', { skip, timeout: 120000 }, async () => {
  fs.writeFileSync(path.join(dir, 'src', 'zcl_cfl_batch_input.clas.abap'), `CLASS zcl_cfl_batch_input DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES if_oo_adt_classrun.
ENDCLASS.
CLASS zcl_cfl_batch_input IMPLEMENTATION.
  METHOD if_oo_adt_classrun~main.
    DATA flights TYPE zcfl_t_flights.
    DATA listobject TYPE STANDARD TABLE OF abaplist WITH DEFAULT KEY.
    DATA ascii TYPE string_table.
    DATA bdc TYPE STANDARD TABLE OF bdcdata WITH DEFAULT KEY.
    DATA msgs TYPE STANDARD TABLE OF bdcmsgcoll WITH DEFAULT KEY.
    CALL FUNCTION 'Z_CFL_FLIGHTS' EXPORTING iv_carrier = 'LH' IMPORTING et_flights = flights EXCEPTIONS not_found = 1.
    out->write( |fm { lines( flights ) }| ).
    SUBMIT zcflight_report WITH p_carr = 'AA' EXPORTING LIST TO MEMORY AND RETURN.
    CALL FUNCTION 'LIST_FROM_MEMORY' TABLES listobject = listobject EXCEPTIONS not_found = 1.
    CALL FUNCTION 'LIST_TO_ASCI' TABLES listobject = listobject listasci = ascii.
    out->write( |list { concat_lines_of( table = ascii sep = \` | \` ) }| ).
    bdc = VALUE #( ( program = 'ZCFLIGHT_MAINT' dynpro = '0100' dynbegin = 'X' )
                   ( fnam = 'GV_CARRIER' fval = 'LH' ) ( fnam = 'GV_CONNECTION' fval = '0400' ) ( fnam = 'BDC_OKCODE' fval = '=SHOW' ) ).
    CALL TRANSACTION 'ZCFL' USING bdc MODE 'N' MESSAGES INTO msgs.
    out->write( |tcode { sy-subrc } { msgs[ 1 ]-msgtyp } { msgs[ 1 ]-msgv1 }| ).
  ENDMETHOD.
ENDCLASS.
`);
  ws.activate();
  await ws.classic.ensure();                                                // the running engine is used
  const r = ws.runClass('zcl_cfl_batch_input');
  assert.equal(r.ok, true, r.error);
  assert.match(r.output, /fm 2/);
  assert.match(r.output, /list .*Flights of AA.*0017 New York 420\.00/);
  assert.match(r.output, /tcode 0 S Flight LH 0400 found/);
  fs.rmSync(path.join(dir, 'src', 'zcl_cfl_batch_input.clas.abap'));
  ws.activate();
});

test('function module test (SE37): typed parameters, exports, classic exceptions, test page', { skip, timeout: 60000 }, async () => {
  const base = (await ws.classic.ensure()).url.replace('localhost', '127.0.0.1');
  const list = await (await fetch(`${base}__rap/api/functions`)).json();
  const fm = list.find(f => f.name === 'Z_CFL_FLIGHTS');
  assert.equal(fm.sections.IMPORTING[0].shape, 'DTEL');
  assert.deepEqual(fm.sections.IMPORTING[0].values.map(v => v.low), ['LH', 'AA']);
  const run = async params => (await fetch(`${base}__rap/api/functions/Z_CFL_FLIGHTS`, { method: 'POST', body: JSON.stringify({ params }) })).json();
  const ok = await run({ IV_CARRIER: 'LH' });
  assert.equal(ok.subrc, 0);
  assert.deepEqual(ok.exporting.ET_FLIGHTS.map(r => r.CONNECTION_ID), ['0400', '0401']);
  assert.equal(ok.exporting.EV_TOTAL, 1250);
  const none = await run({ IV_CARRIER: 'UA' });
  assert.deepEqual([none.subrc, none.exception], [1, 'NOT_FOUND']);
  const page = plain(await (await fetch(`${base}__rap/functions/Z_CFL_FLIGHTS`, { method: 'POST', body: 'IV_CARRIER=AA', headers: { 'content-type': 'application/x-www-form-urlencoded' } })).text());
  assert.match(page, /sy-subrc 0 .*ET_FLIGHTS 1 line\(s\)/);
});

test('application log and a background job scheduled from ABAP, shown on the system pages', { skip, timeout: 60000 }, async () => {
  const base = (await ws.classic.ensure()).url.replace('localhost', '127.0.0.1');
  const out = await runReport(base, 'ZCFLIGHT_BATCH', { P_MAX: '620' });
  assert.match(out, /Log saved with 3 messages/);
  const count = /Job ZCFL_PRICES (\d{8}) released/.exec(out)?.[1];
  assert.ok(count, out);
  const job = await waitFor(async () => { const j = await (await fetch(`${base}__rap/api/jobs/${count}`)).json(); return j?.status === 'F' ? j : null; });
  assert.ok(job, 'the job finished');
  assert.match(job.steps[0].spool, /0400 Frankfurt 600\.00/);
  const logs = plain(await (await fetch(`${base}__rap/logs`)).text());
  assert.match(logs, /Price check ZCFL PRICES/);
  assert.match(logs, /1 warnings/);
  // scheduled from the Jobs page with selection values
  const r = await fetch(`${base}__rap/jobs`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ jobname: 'AA_ONLY', program: 'ZCFLIGHT_REPORT', params: 'P_CARR=AA', start: 'now', period: '0' }) });
  const second = /Job (\d{8}) scheduled/.exec(decodeURIComponent(r.headers.get('location')))?.[1];
  const done = await waitFor(async () => { const j = await (await fetch(`${base}__rap/api/jobs/${second}`)).json(); return j?.status === 'F' ? j : null; });
  assert.match(done.steps[0].spool, /0017 New York/);
  assert.doesNotMatch(done.steps[0].spool, /Frankfurt/);
});

test('print form rendered to PDF by the form engine and put into the output queue', { skip, timeout: 60000 }, async () => {
  const base = (await ws.classic.ensure()).url.replace('localhost', '127.0.0.1');
  const out = await runReport(base, 'ZCFLIGHT_PRINT', { P_CARR: 'LH' });
  assert.match(out, /PDF size \d+ bytes/);
  const id = /Output request (\d+) created/.exec(out)?.[1];
  assert.ok(id, out);
  const bytes = Buffer.from(await (await fetch(`${base}__rap/output/${id}.pdf`)).arrayBuffer());
  assert.match(bytes.toString('latin1'), /^%PDF-1\.4/);
  const { pdfText } = await import('../src/classic/client.mjs');
  const texts = pdfText(bytes);
  assert.ok(texts.includes('Flight list LH'), texts.join('|'));
  assert.ok(texts.includes('1,250.00'));                                        // the table total
  assert.ok(texts.includes('Page 1 of 1'));
  const preview = await fetch(`${base}__rap/forms/ZCFL_FLIGHT_LIST.pdf`);
  assert.equal(preview.headers.get('content-type'), 'application/pdf');
  assert.match(plain(await (await fetch(`${base}__rap/tables/zcflight_a?f_carrier_id=AA`)).text()), /zcflight_a 1 rows/);
});

test('Adobe XDP form from a driver program: FP_JOB_OPEN, FP_FUNCTION_MODULE_NAME, the generated function module, FP_JOB_CLOSE', { skip, timeout: 60000 }, async () => {
  const base = (await ws.classic.ensure()).url.replace('localhost', '127.0.0.1');
  const pre = await runReport(base, 'ZCFLIGHT_ADOBE', { P_CARR: 'LH', P_PREV: 'X' });
  assert.match(pre, /Function module \/1BCDWB\/SM\d{8}/);
  assert.match(pre, /PDF 1 page\(s\), \d{4,} bytes/);
  const printed = await runReport(base, 'ZCFLIGHT_ADOBE', { P_CARR: 'AA', P_PREV: '' });
  assert.match(printed, /Sent to the output queue/);
  const row = ws.app.db.prepare("SELECT id FROM rap_output WHERE title = 'Flight card AA' ORDER BY id DESC").get();
  assert.ok(row, 'the output request');
  const pdf = Buffer.from(await (await fetch(`${base}__rap/output/${row.id}.pdf`)).arrayBuffer());
  assert.match(pdf.toString('latin1'), /^%PDF/);
  // the data reached the layout: rendered the same way as the engine does, the page text has the flight
  const { renderXdp } = await import('../src/forms/xfa/render.js');
  const r = renderXdp(fs.readFileSync(path.join(dir, 'src', 'zcfl_flight_card.xdp')), { is_flight: { carrier_id: 'AA', connection_id: '0017', city_from: 'New York', price: 420 } });
  assert.ok(r.text[0].includes('New York') && r.text[0].includes('420.00'), r.text[0].join('|'));
});

test('spool: the forms of one FP job are one output request with the PDFs merged; queue, copies and e_result-spoolids', { skip, timeout: 60000 }, async () => {
  const base = (await ws.classic.ensure()).url.replace('localhost', '127.0.0.1');
  const out = await runReport(base, 'ZCFLIGHT_SPOOL', { P_DEST: 'LBL1' });
  assert.match(out, /Requests 1/);
  const id = Number(/Request (\d+)/.exec(out.replace(/Requests \d+/, ''))?.[1]);
  const row = ws.app.db.prepare('SELECT * FROM rap_output WHERE id = ?').get(id);
  assert.ok(row, out);
  assert.equal(row.title, 'Flight cards');
  assert.equal(row.qname, 'LBL1');
  assert.equal(row.copies, 2);
  assert.equal(row.pages, 3);                       // one card per flight (3 flights)
  const pdf = Buffer.from(await (await fetch(`${base}__rap/output/${id}.pdf`)).arrayBuffer());
  assert.equal((pdf.toString('latin1').match(/\/Type \/Page\b/g) || []).length, 3);
  const page = plain(await (await fetch(`${base}__rap/output`)).text());
  assert.match(page, /LBL1/);
});

test('a report reads a table that another app of the system owns', { skip, timeout: 120000 }, async () => {
  const fixture = new URL('../examples/classic', import.meta.url).pathname;
  fs.writeFileSync(path.join(sys, '.rap-system.json'), '{}');
  const owner = path.join(sys, 'flights'), reports = path.join(sys, 'flight-reports');
  fs.mkdirSync(path.join(owner, 'src'), { recursive: true });
  fs.mkdirSync(path.join(reports, 'src'), { recursive: true });
  fs.cpSync(path.join(fixture, 'data'), path.join(owner, 'data'), { recursive: true });
  fs.copyFileSync(path.join(fixture, 'src', 'zcflight_a.tabl.cds'), path.join(owner, 'src', 'zcflight_a.tabl.cds'));
  for (const f of ['zcflight_report.prog.abap', 'zcflight_report.prog.xml']) fs.copyFileSync(path.join(fixture, 'src', f), path.join(reports, 'src', f));
  open.push(new Workspace(owner, { systemDir: sys, lint: false }));               // creates and seeds the owner's table
  const w = new Workspace(reports, { systemDir: sys, lint: false });
  open.push(w);
  const st = await w.classic.ensure();
  assert.equal(st.state, 'running', JSON.stringify(st.diagnostics));
  const list = await runReport(st.url.replace('localhost', '127.0.0.1'));
  assert.match(list, /0400 Frankfurt/);
  assert.doesNotMatch(list, /0017/);
});

test('command line: programs, report, transaction, job, log, form and table from the app folder', { skip, timeout: 120000 }, async () => {
  const { spawn } = await import('node:child_process');
  const http = await import('node:http');
  await ws.classic.ensure();
  // stands in for the studio's /a/<app>/api/classic, so the commands use the engine of this test
  const studio = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(ws.classic.status())); });
  await new Promise(r => studio.listen(0, '127.0.0.1', r));
  const rap = (...args) => new Promise(resolve => {
    const p = spawn(process.execPath, [new URL('../bin/rap.js', import.meta.url).pathname, ...args], { cwd: dir, env: { ...process.env, RAP_PORT: String(studio.address().port) } });
    let out = '';
    p.stdout.on('data', d => { out += d; }); p.stderr.on('data', d => { out += d; });
    p.on('exit', code => resolve({ code, out }));
  });
  try {
    assert.match((await rap('programs')).out, /ZCFLIGHT_MAINT\s+module pool tcode ZCFL/);
    const rep = await rap('program', 'ZCFLIGHT_REPORT', 'P_CARR=AA');
    assert.equal(rep.code, 0, rep.out);
    assert.match(rep.out, /0017 New York 420\.00/);
    const tr = await rap('transaction', 'ZCFL', 'GV_CARRIER=LH', 'GV_CONNECTION=0400', '--step', 'SHOW');
    assert.match(tr.out, /Message: Flight LH 0400 found/);
    assert.match(tr.out, /GV_CITY\s+Frankfurt/);
    assert.match(tr.out, /Function codes: .*SHOW \(Display\)/);
    const job = await rap('job', 'schedule', 'ZCFLIGHT_REPORT', 'P_CARR=LH', '--name', 'CLI_JOB');
    assert.equal(job.code, 0, job.out);
    assert.match(job.out, /Job CLI_JOB \d{8}: finished/);
    assert.match(job.out, /0401 New York/);
    assert.match((await rap('jobs')).out, /CLI_JOB\s+finished/);
    await rap('program', 'ZCFLIGHT_BATCH', 'P_MAX=620');
    const logs = (await rap('logs')).out;
    assert.match(logs, /ZCFL\/PRICES {2}Price check {2}3 messages, 1 warnings {2}\(ZCFLIGHT_BATCH, DEVELOPER\)/);
    const handle = /^(\d+)\s/m.exec(logs)[1];
    assert.match((await rap('log', handle)).out, /W {2}LH 0401 costs 650\.00, more than 620/);
    const form = await rap('form', 'ZCFL_FLIGHT_LIST', '--data', JSON.stringify({ carrier: 'AA', carrier_name: 'American', flights: [{ connection_id: '0017', city_from: 'New York', price: 420 }] }), '--print', '--title', 'AA list');
    assert.match(form.out, /Form ZCFL_FLIGHT_LIST with the given data: 1 page\(s\), \d+ bytes/);
    assert.match(form.out, /Output request \d+/);
    assert.match(form.out, /Flight list AA/);
    assert.match((await rap('outputs')).out, /ZCFL_FLIGHT_LIST\s+AA list/);
    assert.match((await rap('table', 'zcflight_a', 'carrier_id=LH')).out, /LH \| 0400 \| Frankfurt[\s\S]*\(2 rows\)/);
  } finally { studio.close(); }
});

test('AUTHORITY-CHECK uses the studio\'s users and roles; a deleted program does not break the others', { skip, timeout: 300000 }, async () => {
  const app = fs.mkdtempSync(path.join(os.tmpdir(), 'rap-classic-auth-'));
  const prog = (name, body) => {
    fs.mkdirSync(path.join(app, 'src'), { recursive: true });
    fs.writeFileSync(path.join(app, 'src', `${name}.prog.abap`), `REPORT ${name}.\nPARAMETERS p_x TYPE c LENGTH 1.\nSTART-OF-SELECTION.\n${body}\n`);
    fs.writeFileSync(path.join(app, 'src', `${name}.prog.xml`), `<?xml version="1.0" encoding="utf-8"?>\n<abapGit version="v1.0.0" serializer="LCL_OBJECT_PROG" serializer_version="v1.0.0">\n <asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0">\n  <asx:values>\n   <PROGDIR><NAME>${name.toUpperCase()}</NAME><SUBC>1</SUBC></PROGDIR>\n  </asx:values>\n </asx:abap>\n</abapGit>\n`);
  };
  // sy-subrc is kept in variables: WRITE itself sets it
  prog('zauth', `  AUTHORITY-CHECK OBJECT 'Z_OBJ' ID 'ACTVT' FIELD '03' ID 'VAL' FIELD 'A'.
  DATA(lv_a) = sy-subrc.
  AUTHORITY-CHECK OBJECT 'Z_OBJ' ID 'ACTVT' FIELD '03' ID 'VAL' FIELD 'B'.
  DATA(lv_b) = sy-subrc.
  WRITE: / |A={ lv_a } B={ lv_b }|.`);
  prog('zother', `  WRITE / 'other'.`);
  const w = new Workspace(app, { systemDir: false, lint: false });
  open.push(w);
  try {
    // no users: everything is allowed (development), as in RAP code
    let st = await w.classic.ensure();
    assert.equal(st.state, 'running', JSON.stringify(st.diagnostics));
    assert.match(await runReport(st.url.replace('localhost', '127.0.0.1'), 'ZAUTH', {}), /A=0 B=0/);
    // with users: the roles of the user decide
    const { authStoreFor } = await import('../src/server/auth.js');
    const store = authStoreFor(app);
    store.setUser('DEVELOPER', { password: 'secret', roles: ['Z_VIEWER'] });
    store.grant('Z_VIEWER', 'Z_OBJ', { ACTVT: '03', VAL: 'A' });
    assert.match(await runReport(st.url.replace('localhost', '127.0.0.1'), 'ZAUTH', {}), /A=0 B=4/);
    // a deleted program leaves no entry behind that breaks the program discovery
    fs.rmSync(path.join(app, 'src', 'zother.prog.abap')); fs.rmSync(path.join(app, 'src', 'zother.prog.xml'));
    st = await w.classic.ensure();
    assert.deepEqual(st.list.map(p => p.name), ['ZAUTH']);
    assert.match(await runReport(st.url.replace('localhost', '127.0.0.1'), 'ZAUTH', {}), /A=0 B=4/);
  } finally { w.classic.stop?.(); fs.rmSync(app, { recursive: true, force: true }); }
});

test('gui_download in a report hands the file to the browser: selection screen button and START-OF-SELECTION', { skip, timeout: 300000 }, async () => {
  const app = fs.mkdtempSync(path.join(os.tmpdir(), 'rap-classic-dl-'));
  fs.mkdirSync(path.join(app, 'src'));
  fs.writeFileSync(path.join(app, 'src', 'zdown.prog.abap'), `REPORT zdown.
TABLES sscrfields.
PARAMETERS p_x TYPE c LENGTH 1.
SELECTION-SCREEN FUNCTION KEY 1.

CLASS lcl_file DEFINITION.
  PUBLIC SECTION.
    CLASS-METHODS save IMPORTING iv_name TYPE string iv_text TYPE string.
ENDCLASS.

CLASS lcl_file IMPLEMENTATION.
  METHOD save.
    DATA(lt_lines) = VALUE string_table( ( \`A;B\` ) ( iv_text ) ).
    cl_gui_frontend_services=>gui_download( EXPORTING filename = iv_name
                                            CHANGING  data_tab = lt_lines
                                            EXCEPTIONS OTHERS  = 1 ).
    IF sy-subrc = 0.
      MESSAGE |{ iv_name } saved| TYPE 'S'.
    ELSE.
      MESSAGE |{ iv_name } failed| TYPE 'S'.
    ENDIF.
  ENDMETHOD.
ENDCLASS.

INITIALIZATION.
  sscrfields-functxt_01 = 'Export'.

AT SELECTION-SCREEN.
  IF sscrfields-ucomm = 'FC01'.
    lcl_file=>save( iv_name = \`button.csv\` iv_text = \`1;2\` ).
  ENDIF.

START-OF-SELECTION.
  lcl_file=>save( iv_name = \`list.csv\` iv_text = \`3;4\` ).
  WRITE / 'done'.
`);
  fs.writeFileSync(path.join(app, 'src', 'zdown.prog.xml'), `<?xml version="1.0" encoding="utf-8"?>\n<abapGit version="v1.0.0" serializer="LCL_OBJECT_PROG" serializer_version="v1.0.0">\n <asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0">\n  <asx:values>\n   <PROGDIR><NAME>ZDOWN</NAME><SUBC>1</SUBC></PROGDIR>\n  </asx:values>\n </asx:abap>\n</abapGit>\n`);
  const w = new Workspace(app, { systemDir: false, lint: false });
  open.push(w);
  const files = html => [...html.matchAll(/download="([^"]+)" data-gg-download="([^"]+)"/g)].map(m => [m[1], Buffer.from(m[2], 'base64').toString()]);
  try {
    const st = await w.classic.ensure();
    assert.equal(st.state, 'running', JSON.stringify(st.diagnostics));
    const base = st.url.replace('localhost', '127.0.0.1');
    const submit = async ucomm => {
      const sel = await fetch(`${base}program?name=ZDOWN`);
      const cookie = sel.headers.get('set-cookie')?.split(';')[0] || '';
      const html = await sel.text();
      const form = new URLSearchParams({ session_id: field(html, 'session_id'), page_id: field(html, 'page_id'), gg_action: 'SUBMIT', gg_ucomm: ucomm });
      return (await fetch(`${base}dispatch`, { method: 'POST', body: form, headers: { 'content-type': 'application/x-www-form-urlencoded', cookie } })).text();
    };
    // the function key on the selection screen: the selection screen comes back and saves the file
    let html = await submit('FC01');
    assert.match(plain(html), /button\.csv saved/);
    assert.deepEqual(files(html), [['button.csv', 'A;B\r\n1;2\r\n']]);
    // START-OF-SELECTION: the list page saves it, once
    html = await submit('ONLI');
    assert.match(plain(html), /done/);
    assert.deepEqual(files(html), [['list.csv', 'A;B\r\n3;4\r\n']]);
  } finally { w.classic.stop?.(); fs.rmSync(app, { recursive: true, force: true }); }
});

test('debugger: a breakpoint in a report stops the run of the preview, shows the variables, steps and continues', { skip, timeout: 300000 }, async () => {
  const app = fs.mkdtempSync(path.join(os.tmpdir(), 'rap-classic-dbg-'));
  fs.mkdirSync(path.join(app, 'src'));
  fs.writeFileSync(path.join(app, 'src', 'zdbg.prog.abap'), `REPORT zdbg.
PARAMETERS p_count TYPE i DEFAULT 3.
DATA gv_total TYPE i.

CLASS lcl_calc DEFINITION FINAL.
  PUBLIC SECTION.
    CLASS-METHODS square
      IMPORTING iv_value        TYPE i
      RETURNING VALUE(rv_value) TYPE i.
ENDCLASS.

CLASS lcl_calc IMPLEMENTATION.
  METHOD square.
    DATA(lv_factor) = iv_value.
    rv_value = iv_value * lv_factor.
  ENDMETHOD.
ENDCLASS.

START-OF-SELECTION.
  DO p_count TIMES.
    DATA(lv_square) = lcl_calc=>square( sy-index ).
    gv_total = gv_total + lv_square.
  ENDDO.
  WRITE: / 'Total', gv_total.
`);
  const w = new Workspace(app, { systemDir: false, lint: false });
  try {
    const st = await w.classic.ensure();
    assert.equal(st.state, 'running', JSON.stringify(st.diagnostics));
    const base = st.url.replace('localhost', '127.0.0.1');
    const run = () => runReport(base, 'ZDBG', { P_COUNT: '3' });
    assert.match(await run(), /Total 14/);                               // without the debugger: 1 + 4 + 9
    const state = async want => waitFor(async () => { const s = await w.debugState(); return s.status === want ? s : null; }, 20000);

    // a breakpoint in the method of the local class (line 15): the run stops there with the variables
    await w.debugStart({ kind: 'classic', name: 'ZDBG', breakpoints: ['src/zdbg.prog.abap:15'] });
    const result = run();
    let s = await state('paused');
    assert.ok(s, 'the run stops at the breakpoint');
    assert.equal(s.paused.file, 'src/zdbg.prog.abap');
    assert.equal(s.paused.line, 15);
    assert.deepEqual(s.paused.stack, ['LCL_CALC->SQUARE', 'START-OF-SELECTION']);
    assert.deepEqual(s.paused.vars.iv_value, { t: 'num', v: 1 });
    assert.deepEqual(s.paused.vars.lv_factor, { t: 'num', v: 1 });
    // step out: back in START-OF-SELECTION after the call, with the program's global data
    await w.debugCommand('out');
    s = await state('paused');
    assert.equal(s.paused.line, 22);
    assert.deepEqual(s.paused.stack, ['START-OF-SELECTION']);
    assert.equal(s.paused.meLabel, 'Program globals');
    assert.deepEqual(s.paused.me.comps.p_count, { t: 'num', v: 3 });
    assert.deepEqual(s.paused.me.comps.lv_square, { t: 'num', v: 1 });    // DATA of an event is global data in ABAP
    assert.deepEqual(Object.keys(s.paused.vars), []);                      // the converter's own variables are not shown
    // step over: the next statement of the event, then continue: the breakpoint again in the next loop pass
    await w.debugCommand('over');
    s = await state('paused');
    assert.equal(s.paused.line, 21);
    await w.debugCommand('continue');
    s = await state('paused');
    assert.equal(s.paused.line, 15);
    assert.deepEqual(s.paused.vars.iv_value, { t: 'num', v: 2 });
    // without breakpoints, continue finishes the run with the normal list
    await w.debugCommand('breakpoints', { breakpoints: [] });
    await w.debugCommand('continue');
    assert.match(await result, /Total 14/);
    assert.ok(await state('armed'));

    // "Debug" without breakpoints stops at the first statement of the next run; stop ends the program
    await w.debugCommand('stop');
    await w.debugStart({ kind: 'classic', name: 'ZDBG', breakpoints: [], first: true });
    const second = runReport(base, 'ZDBG', { P_COUNT: '3' });
    s = await state('paused');
    assert.ok(s, 'the first statement stops');
    await w.debugCommand('stop');
    assert.match(await second, /stopped in the debugger/);
    assert.equal((await w.debugState()).status, 'done');
    assert.match(await run(), /Total 14/);                                 // and the engine runs at full speed again

    // change a value: lv_factor 1 -> 10 in the first pass (10 + 4 + 9 = 23); a watchpoint on the global gv_total
    // with a condition stops only where it becomes > 12 (10 -> 14, not 0 -> 10); watches show their values
    await w.debugStart({ kind: 'classic', name: 'ZDBG', breakpoints: ['src/zdbg.prog.abap:15'], watches: [{ expr: 'gv_total' }] });
    const third = run();
    s = await state('paused');
    assert.equal(s.paused.watches[0].value.v, 0);
    s = await w.debugCommand('set', { expr: 'lv_factor', value: '10' });
    assert.deepEqual(s.paused.vars.lv_factor, { t: 'num', v: 10 });
    await w.debugCommand('breakpoints', { breakpoints: [] });
    await w.debugCommand('watches', { watches: [{ expr: 'gv_total', stop: true, cond: '> 12' }] });
    await w.debugCommand('continue');
    s = await waitFor(async () => { const x = await w.debugState(); return x.status === 'paused' && x.paused?.reason ? x : null; }, 20000);
    assert.ok(s, 'the watchpoint stops');
    assert.equal(s.paused.reason.expr, 'gv_total');
    assert.deepEqual([s.paused.reason.old.v, s.paused.reason.value.v], [10, 14]);
    await w.debugCommand('watches', { watches: [] });
    await w.debugCommand('continue');
    assert.match(await third, /Total 23/);
  } finally { w.close(); fs.rmSync(app, { recursive: true, force: true }); }
});
