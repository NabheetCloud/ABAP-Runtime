// Creating objects by hand (src/server/generate.js): every New Object template activates without errors, and the
// RAP business object generator turns a table into a working OData service with draft and a Fiori elements app.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Workspace } from '../src/server/server.js';
import { KINDS, objectFiles, rapBoFiles, appContext, behaviorPool, camel } from '../src/server/generate.js';
import { generateXdp } from '../src/forms/xfa/generate.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rap-gen-'));
fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
const open = [];
after(() => { for (const w of open) w.close(); fs.rmSync(dir, { recursive: true, force: true }); });
const ws0 = () => { const w = new Workspace(dir, { dbFile: ':memory:', systemDir: false, lint: false }); open.push(w); return w; };
const write = files => { for (const [f, t] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), t); } };
const errorsOf = (ws, files) => ws.app.diagnostics.errors.filter(e => Object.keys(files).some(f => path.basename(f) === path.basename(String(e.file || ''))));

test('names: camel case elements, customer namespace', () => {
  assert.equal(camel('travel_uuid'), 'TravelUUID');
  assert.equal(camel('customer_id'), 'CustomerID');
  assert.equal(camel('local_last_changed_at'), 'LocalLastChangedAt');
  assert.throws(() => objectFiles('class', { name: 'CL_X' }), /Z or Y/);
});

test('a table, then the RAP business object generator: views, behavior with draft, service, OData with rows', () => {
  const t = objectFiles('table', { name: 'ZGEN_ORDER_A', description: 'Orders', keys: '', fields: 'description abap.char(80)\namount abap.curr(15,2)\ncurrency abap.cuky\nstatus abap.char(1)' });
  write(t.files);
  let ws = ws0();
  assert.deepEqual(errorsOf(ws, t.files), []);
  const ctx = appContext(ws);
  const bo = rapBoFiles(ctx, { table: 'zgen_order_a', name: 'GenOrder', draft: true });
  assert.ok(bo.draft, bo.notes.join('\n'));
  assert.deepEqual(Object.keys(bo.files).sort(), ['src/zbp_r_genorder.clas.abap', 'src/zbp_r_genorder.clas.locals_imp.abap', 'src/zc_genorder.bdef.asbdef', 'src/zc_genorder.ddls.asddls', 'src/zc_genorder.ddlx.asddlxs', 'src/zgen_order_d.tabl.cds', 'src/zr_genorder.bdef.asbdef', 'src/zr_genorder.ddls.asddls', 'src/zui_genorder.srvd.srvdsrv']);
  write(bo.files);
  ws.close(); ws = ws0();
  assert.deepEqual(ws.app.diagnostics.errors, []);
  // create a draft, activate it, read it back
  const S = '/odata/zui_genorder';
  const c = ws.odata.handle('POST', `${S}/GenOrder`, { Description: 'First order', Amount: 12.5, Currency: 'EUR' }, {});
  assert.equal(c.status, 201, JSON.stringify(c.body));
  const kf = Object.keys(c.body).find(k => /UUID$/.test(k));
  const a = ws.odata.handle('POST', `${S}/GenOrder(${kf}=${c.body[kf]},IsActiveEntity=false)/com.sap.gateway.srvd.zui_genorder.v0001.Activate`, {}, {});
  assert.equal(a.status, 200, JSON.stringify(a.body));
  const list = ws.odata.handle('GET', `${S}/GenOrder?$filter=IsActiveEntity eq true`, null, {});
  assert.equal(list.body.value.length, 1);
  assert.equal(list.body.value[0].Description, 'First order');
  assert.match(fs.readFileSync(path.join(dir, 'src/zc_genorder.ddlx.asddlxs'), 'utf8'), /lineItem/);
});

test('every New Object template activates without errors', () => {
  let ws = ws0();
  const ctx = appContext(ws);
  ctx.xdp = (srvd, title) => generateXdp({ title, srv: ws.app.model.services.get(srvd.toLowerCase()), model: ws.app.model });
  const opts = {
    dtel: { name: 'ZGEN_STATUS', datatype: 'CHAR', length: 1 },
    doma: { name: 'ZGEN_STATUSD', values: 'O Open\nC Closed' },
    ttyp: { name: 'ZGEN_T_ORDERS', rowtype: 'ZGEN_ORDER_A' },
    enqu: { name: 'EZGEN_ORDER', table: 'zgen_order_a' },
    view: { name: 'ZI_GENORDER', source: 'zgen_order_a', viewKind: 'basic' },
    projection: { name: 'ZC_GENORDERRO', source: 'ZR_GenOrder' },
    abstract: { name: 'ZA_GENREASON' },
    custom: { name: 'ZCE_GENITEM' },
    ddlx: { name: 'ZI_GENORDER', source: 'ZI_GENORDER' },
    dcls: { name: 'ZI_GENORDER', source: 'ZI_GENORDER' },
    bdef: null, bpool: null,
    srvd: { name: 'ZUI_GENRO', views: 'ZI_GENORDER' },
    class: { name: 'ZCL_GEN_DEMO', classKind: 'unit tests included' },
    exception: { name: 'ZCX_GEN_ERROR' },
    intf: { name: 'ZIF_GEN_RUNNER' },
    report: { name: 'ZGEN_ORDERS', table: 'zgen_order_a', alv: true },
    modulepool: { name: 'ZGEN_DIALOG', tcode: 'ZGEND' },
    fugr: { name: 'ZGEN', fm: 'Z_GEN_UPPER' },
    msag: { name: 'ZGEN' },
    xdpform: { name: 'ZF_GENORDER', title: 'Order', dataProvider: 'ZUI_GENORDER' },
    jsonform: { name: 'ZGEN_LETTER', title: 'Letter' },
    xslt: { name: 'ZGEN_ROWS' },
    job: { name: 'ZJC_GEN_IMPORT' },
    bgpf: { name: 'ZCL_GEN_BGPF' },
  };
  const done = [];
  // views first (others refer to them), activated in between so the context knows them
  for (const kind of ['dtel', 'doma', 'ttyp', 'enqu', 'view', 'abstract', 'custom', 'projection', 'ddlx', 'dcls', 'srvd', 'class', 'exception', 'intf', 'report', 'modulepool', 'fugr', 'msag', 'xdpform', 'jsonform', 'xslt', 'job', 'bgpf']) {
    const c = appContext(ws);
    c.xdp = ctx.xdp;
    const r = objectFiles(kind, opts[kind], c);
    write(r.files);
    ws.close(); ws = ws0();
    assert.deepEqual(errorsOf(ws, r.files).map(e => `${e.file}: ${e.message}`), [], kind);
    done.push(kind);
  }
  assert.ok(ws.app.model.services.get('zui_genro'));
  assert.equal(new Set(KINDS.map(k => k.id)).size, KINDS.length);
  assert.ok(done.length >= 22);
  // a behavior pool for a BDEF with features, determinations, validations and actions
  const pool = behaviorPool('x', 'managed implementation in class zbp_x unique;\ndefine behavior for ZR_X alias X\nauthorization master ( instance )\n{ update ( features : instance );\n  action ( features : instance ) accept result [1] $self;\n  determination setDefaults on modify { create; }\n  validation validateDates on save { create; }\n}', 'zbp_x');
  const imp = pool['src/zbp_x.clas.locals_imp.abap'];
  for (const m of ['get_instance_authorizations', 'get_instance_features', 'accept FOR MODIFY', 'setDefaults FOR DETERMINE ON MODIFY', 'validateDates FOR VALIDATE ON SAVE']) assert.ok(imp.includes(m), m);
});
