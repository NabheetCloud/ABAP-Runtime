// F4 value help of classic screens: the field's dictionary reference decides the values (check table of the table
// field, fixed values of the domain, value table of the domain), found from the screen field's name and the programs'
// declarations; the engine serves which fields have a help and their hit lists, searchable.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { Workspace } from '../src/server/server.js';
import { classicAvailable } from '../src/classic/build.mjs';
import { catalog, resolveField, helpOf } from '../src/classic/valuehelp.mjs';

const skip = !classicAvailable() ? 'classic engine not installed (npm run setup:open-abap)' : /^pglite|^postgres/.test(process.env.RAP_DB || '') ? 'the classic engine uses the SQLite database' : false;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rap-f4-'));
fs.cpSync(new URL('./fixtures/po-classic', import.meta.url).pathname, dir, { recursive: true });
// a vendor master as the check table of the PO header's vendor, and a domain with a value table
fs.writeFileSync(path.join(dir, 'src', 'zpo_vendor.tabl.cds'), `@EndUserText.label : 'Vendors'
@AbapCatalog.tableCategory : #TRANSPARENT
@AbapCatalog.deliveryClass : #A
define table zpo_vendor {
  key client : abap.clnt not null;
  @EndUserText.label : 'Vendor'
  key lifnr  : abap.char(10) not null;
  @EndUserText.label : 'Name'
  name1      : abap.char(40);
  @EndUserText.label : 'City'
  city       : abap.char(30);
}
`);
const head = path.join(dir, 'src', 'zpo_head.tabl.cds');
fs.writeFileSync(head, fs.readFileSync(head, 'utf8').replace(/  lifnr\s+: abap\.char\(10\);/, '  lifnr                 : abap.char(10)\n    with foreign key zpo_vendor where lifnr = zpo_head.lifnr;'));
fs.mkdirSync(path.join(dir, 'data'), { recursive: true });
fs.writeFileSync(path.join(dir, 'data', 'zpo_vendor.json'), JSON.stringify([
  { lifnr: 'V100', name1: 'Acme Supplies', city: 'Berlin' }, { lifnr: 'V200', name1: 'Globex Parts', city: 'Pune' }, { lifnr: 'V300', name1: 'Initech Metals', city: 'Austin' }]));
fs.writeFileSync(path.join(dir, 'src', 'zpo_vendor_id.doma.xml'), `<?xml version="1.0" encoding="utf-8"?>
<abapGit version="v1.0.0" serializer="LCL_OBJECT_DOMA" serializer_version="v1.0.0">
 <asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0">
  <asx:values>
   <DD01V><DOMNAME>ZPO_VENDOR_ID</DOMNAME><DDLANGUAGE>E</DDLANGUAGE><DATATYPE>CHAR</DATATYPE><LENG>000010</LENG><OUTPUTLEN>000010</OUTPUTLEN><ENTITYTAB>ZPO_VENDOR</ENTITYTAB><DDTEXT>Vendor</DDTEXT></DD01V>
  </asx:values>
 </asx:abap>
</abapGit>
`);
fs.writeFileSync(path.join(dir, 'src', 'zpo_vendor_id.dtel.xml'), `<?xml version="1.0" encoding="utf-8"?>
<abapGit version="v1.0.0" serializer="LCL_OBJECT_DTEL" serializer_version="v1.0.0">
 <asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0">
  <asx:values>
   <DD04V><ROLLNAME>ZPO_VENDOR_ID</ROLLNAME><DDLANGUAGE>E</DDLANGUAGE><DOMNAME>ZPO_VENDOR_ID</DOMNAME><REFKIND>D</REFKIND><HEADLEN>10</HEADLEN><SCRLEN1>10</SCRLEN1><SCRLEN2>15</SCRLEN2><SCRLEN3>20</SCRLEN3>
    <DDTEXT>Vendor</DDTEXT><REPTEXT>Vendor</REPTEXT><SCRTEXT_S>Vendor</SCRTEXT_S><SCRTEXT_M>Vendor</SCRTEXT_M><SCRTEXT_L>Vendor</SCRTEXT_L></DD04V>
  </asx:values>
 </asx:abap>
</abapGit>
`);
const rep = path.join(dir, 'src', 'zpo_report.prog.abap');
fs.writeFileSync(rep, fs.readFileSync(rep, 'utf8').replace('  PARAMETERS p_stat TYPE zpo_stat.', '  PARAMETERS: p_stat TYPE zpo_stat,\n              p_vend TYPE zpo_vendor_id.'));

let ws, base;
after(() => { ws?.close(); fs.rmSync(dir, { recursive: true, force: true }); });

test('F4: the screen field resolves to its dictionary reference and value source', () => {
  const cat = catalog(dir);
  const src = (name, program = 'ZPO_REPORT') => helpOf(cat, resolveField(cat, name, program));
  assert.deepEqual(src('S_LIFNR-LOW'), { kind: 'check', table: 'zpo_vendor', key: 'lifnr' }, 'select-option FOR a table field with a check table');
  assert.deepEqual(src('gg_editor_S_LIFNR-2-HIGH'), { kind: 'check', table: 'zpo_vendor', key: 'lifnr' }, 'a row of the multiple-selection editor');
  assert.equal(src('P_STAT').kind, 'fixed', 'parameter typed by a data element with fixed values');
  assert.deepEqual(src('P_STAT').values.map(v => v.low), ['N', 'R', 'C']);
  assert.deepEqual(src('P_VEND'), { kind: 'check', table: 'zpo_vendor', key: null }, 'chained PARAMETERS: the domain value table');
  assert.equal(src('ZPO_HEAD-LIFNR', 'ZPO_MAINT').kind, 'check', 'dynpro field of a TABLES work area');
  assert.equal(src('GS_HEAD-STATUS', 'ZPO_MAINT').kind, 'fixed', 'dynpro field of a structure variable');
  for (const n of ['S_EBELN-LOW', 'P_NEWPO', 'P_ALV', 'GV_OK_CODE', 'NOPE', 'ZPO_HEAD-NETWR']) assert.equal(src(n, n === 'GV_OK_CODE' ? 'ZPO_MAINT' : 'ZPO_REPORT'), null, n);
});

test('F4: the engine lists the fields with a value help and serves searchable hit lists', { skip, timeout: 180000 }, async () => {
  ws = new Workspace(dir, { systemDir: false, lint: false });
  assert.deepEqual(ws.app.diagnostics.errors, []);
  const st = await ws.classic.ensure();
  assert.equal(st.state, 'running', JSON.stringify(st.diagnostics));
  base = st.url.replace('localhost', '127.0.0.1');
  const has = await (await fetch(`${base}__rap/f4/fields?program=ZPO_REPORT&names=S_EBELN-LOW,S_LIFNR-LOW,P_STAT,P_VEND,P_ALV,bad%20name`)).json();
  assert.deepEqual(has, { 'S_EBELN-LOW': false, 'S_LIFNR-LOW': true, P_STAT: true, P_VEND: true, P_ALV: false });

  let r = await (await fetch(`${base}__rap/f4?field=S_LIFNR-LOW&program=ZPO_REPORT`)).json();
  assert.equal(r.table, 'ZPO_VENDOR');
  assert.deepEqual(r.columns.map(c => c.label), ['Vendor', 'Name', 'City']);
  assert.deepEqual(r.rows.map(x => x[r.key]), ['V100', 'V200', 'V300']);
  r = await (await fetch(`${base}__rap/f4?field=S_LIFNR-LOW&program=ZPO_REPORT&q=pune`)).json();
  assert.deepEqual(r.rows, [['V200', 'Globex Parts', 'Pune']], 'search in every shown column');
  r = await (await fetch(`${base}__rap/f4?field=S_LIFNR-LOW&q=${encodeURIComponent("x' OR 1=1 --")}`)).json();
  assert.deepEqual(r.rows, [], 'the search text is a parameter, not SQL');
  r = await (await fetch(`${base}__rap/f4?field=P_STAT&program=ZPO_REPORT&q=rel`)).json();
  assert.deepEqual(r.rows, [['R', 'Released']]);
  assert.equal(r.title, 'PO status');
  r = await (await fetch(`${base}__rap/f4?field=P_VEND&program=ZPO_REPORT`)).json();
  assert.equal(r.rows.length, 3, 'value table of the domain');
  assert.equal((await fetch(`${base}__rap/f4?field=P_ALV`)).status, 404);
  assert.equal((await fetch(`${base}__rap/f4?field=${encodeURIComponent('A"; DROP')}`)).status, 400);
  // the engine answers only for loopback names and refuses changes from other sites
  const port = Number(new URL(base).port);
  const raw = (o) => new Promise((resolve, reject) => { const r = http.request({ host: '127.0.0.1', port, ...o }, res => { res.resume(); res.on('end', () => resolve(res.statusCode)); }); r.on('error', reject); r.end(o.body || ''); });
  assert.equal(await raw({ path: '/__rap/api/tables/zpo_head', headers: { host: `rebind.example:${port}` } }), 421);
  assert.equal(await raw({ method: 'POST', path: '/__rap/functions/ZPO_CREATE', headers: { host: `127.0.0.1:${port}`, origin: 'https://evil.example', 'content-type': 'application/x-www-form-urlencoded' }, body: 'IV_EBELN=1' }), 403);
  assert.equal(await raw({ path: '/__rap/api/tables/zpo_head', headers: { host: `localhost:${port}` } }), 200);
  // the page gets the script that adds the F4 buttons
  const page = await (await fetch(`${base}program?name=ZPO_REPORT`)).text();
  assert.match(page, /\/__rap\/theme\.js/);
  assert.match(await (await fetch(`${base}__rap/theme.js`)).text(), /__rap\/f4\/fields/);
});
