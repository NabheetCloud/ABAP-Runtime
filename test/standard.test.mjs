// The SAP standard layer (standard/s4hana): SAP's tables and released CDS views with seed data, used by any app
// by name: in its CDS views, in ABAP (SELECT), and in classic programs.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { Workspace } from '../src/server/server.js';
import { STANDARD_DIR, systemCatalog } from '../src/rap/catalog.js';
import { classicAvailable } from '../src/classic/build.mjs';

const pg = /^pglite|^postgres/.test(process.env.RAP_DB || '');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rap-standard-'));
after(() => fs.rmSync(dir, { recursive: true, force: true }));
const write = (f, s) => { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), s); };

test('the standard layer activates: SAP tables, released views, seed data', { skip: pg && 'the standard layer is shared through SQLite here' }, () => {
  const ws = new Workspace(STANDARD_DIR, { lint: false, standard: false });
  try {
    assert.deepEqual(ws.app.diagnostics.errors, []);
    const m = ws.app.model;
    for (const t of ['t001', 't001w', 'tcurr', 'but000', 'kna1', 'knvv', 'lfa1', 'lfm1', 'mara', 'makt', 'marc', 'mard', 'mbew', 'ska1', 'csks', 'cepc']) assert.ok(m.tables.has(t), t);
    for (const v of ['i_companycode', 'i_plant', 'i_currency', 'i_exchangeraterawdata', 'i_businesspartner', 'i_customer', 'i_customersalesarea', 'i_supplier',
      'i_product', 'i_productdescription', 'i_productplantbasic', 'i_glaccountinchartofaccounts', 'i_costcenter', 'i_profitcenter', 'i_bank_2']) assert.ok(m.entities.has(v), v);
    const all = sql => ws.app.db.prepare(sql).all();
    assert.equal(all('SELECT * FROM i_companycode').length, 3);
    assert.equal(all("SELECT * FROM i_customer WHERE Country = 'IN'").length, 3);
    assert.equal(all("SELECT ProductDescription FROM i_productdescription WHERE Product = 'TG11' AND Language = 'E'")[0].productdescription, 'Laptop Pro 14');
    assert.ok(all("SELECT * FROM i_exchangeraterawdata WHERE SourceCurrency = 'EUR' AND TargetCurrency = 'INR'").length >= 1);
  } finally { ws.close(); }
});

test('an app uses the standard layer by name: CDS view, ABAP SELECT and the catalog', { skip: pg && 'the standard layer is shared through SQLite here' }, () => {
  write('src/zi_customerlist.ddls.asddls', `@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Customers with their country'
define view entity ZI_CustomerList
  as select from I_Customer
  association [0..1] to I_CountryText as _CountryText on $projection.Country = _CountryText.Country and _CountryText.Language = 'E'
{
  key Customer,
      CustomerName,
      Country,
      _CountryText.CountryName as CountryName
}
`);
  write('src/zcl_std_demo.clas.abap', `CLASS zcl_std_demo DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES if_oo_adt_classrun.
ENDCLASS.
CLASS zcl_std_demo IMPLEMENTATION.
  METHOD if_oo_adt_classrun~main.
    SELECT Product, ProductType FROM I_Product WHERE ProductGroup = 'L001' ORDER BY Product INTO TABLE @DATA(lt_products).
    SELECT SINGLE CompanyCodeName, Currency FROM I_CompanyCode WHERE CompanyCode = '4110' INTO @DATA(ls_cc).
    out->write( |{ lines( lt_products ) } laptops, { ls_cc-CompanyCodeName } in { ls_cc-Currency }| ).
  ENDMETHOD.
ENDCLASS.
`);
  assert.ok(systemCatalog(null, dir).get('i_customer')?.standard);
  const ws = new Workspace(dir, { systemDir: false, lint: false });
  try {
    assert.deepEqual(ws.app.diagnostics.errors, []);
    const rows = ws.app.db.prepare("SELECT * FROM zi_customerlist WHERE Country = 'DE' ORDER BY Customer").all();
    assert.equal(rows.length, 3);
    assert.equal(rows[0].countryname, 'Germany');
  } finally { ws.close(); }
  const r = spawnSync(process.execPath, [new URL('../bin/rap.js', import.meta.url).pathname, 'run', dir, 'zcl_std_demo', '--no-lint'], { encoding: 'utf8' });
  assert.match(r.stdout + r.stderr, /3 laptops, Company Code 4110 in INR/);
});

test('a classic report reads the standard tables', { skip: (!classicAvailable() && 'classic engine not installed') || (pg && 'the classic engine uses SQLite'), timeout: 180000 }, async () => {
  write('src/zstd_products.prog.abap', `REPORT zstd_products.
PARAMETERS p_werks TYPE c LENGTH 4 DEFAULT '1010'.
START-OF-SELECTION.
  SELECT m~matnr, t~maktx, d~labst FROM mara AS m
    INNER JOIN makt AS t ON t~matnr = m~matnr AND t~spras = 'E'
    INNER JOIN mard AS d ON d~matnr = m~matnr
    WHERE d~werks = @p_werks AND m~mtart = 'HAWA'
    ORDER BY m~matnr INTO TABLE @DATA(lt_stock).
  LOOP AT lt_stock INTO DATA(ls_stock).
    WRITE: / ls_stock-matnr, ls_stock-maktx.
  ENDLOOP.
`);
  write('src/zstd_products.prog.xml', fs.readFileSync(new URL('../examples/classic/src/zcflight_report.prog.xml', import.meta.url), 'utf8')
    .replace(/ZCFLIGHT_REPORT/g, 'ZSTD_PRODUCTS').replace('Flights by carrier', 'Products with stock').replace(/<item><ID>S<\/ID>.*?<\/item>/, ''));
  const ws = new Workspace(dir, { systemDir: false, lint: false });
  try {
    const st = await ws.classic.ensure();
    assert.equal(st.state, 'running', JSON.stringify(st.diagnostics));
    const { runProgram } = await import('../src/classic/client.mjs');
    const out = await runProgram(st.url.replace('localhost', '127.0.0.1'), 'ZSTD_PRODUCTS', { P_WERKS: '1710' });
    assert.ok(out.ok, out.message);
    assert.match(out.list, /TG11\s+Laptop Pro 14/);
    assert.match(out.list, /OS01\s+Copy Paper A4/);
  } finally { ws.close(); }
});

test('the studio catalog of the standard layer: business areas, objects with fields, rows', { skip: pg && 'the standard layer is shared through SQLite here' }, async () => {
  const { Studio } = await import('../src/studio/studio.js');
  const appsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rap-standard-studio-'));
  const s = new Studio(appsDir, { port: 1 });
  try {
    const c = s.standardCatalog();
    assert.deepEqual(c.areas.map(a => a.title), ['Organisation', 'Business partners', 'Products', 'Finance', 'Configuration', 'Sales and billing', 'Procurement',
      'Inventory', 'Accounting', 'Production', 'Maintenance and quality', 'Projects and cross-application', 'Warehouse and transportation', 'Compatibility views']);
    assert.equal(c.totals.objects, 190);
    const so = c.areas.find(a => a.id === 'sales').objects.find(o => o.view === 'I_SalesOrder');
    assert.equal(so.table, 'vbak');
    assert.equal(so.rows, 12);
    assert.deepEqual(so.fields.filter(f => f.key).map(f => f.name), ['SalesOrder']);
    assert.ok(so.fields.find(f => f.name === 'OrganizationDivision'), 'element names of the documents are added to the view');
    const wt = c.areas.find(a => a.id === 'logistics').objects.find(o => o.view === 'I_EWMWarehouseTask');
    assert.equal(wt.table, '/scwm/ordim_c');
    assert.ok(wt.rows > 0);
    // the Data tab works for compatibility views too, not only for I_* views
    assert.ok(s.standardRows('BSID').rows.length > 0);
    assert.ok(s.standardRows('mkpf').rows.length > 0);
    const customer = c.areas[1].objects.find(o => o.view === 'I_Customer');
    assert.equal(customer.table, 'kna1');
    assert.equal(customer.rows, 10);
    assert.deepEqual(customer.fields.filter(f => f.key).map(f => f.name), ['Customer']);
    assert.ok(c.areas[0].objects.find(o => o.view === 'I_SalesOrganization').texts.includes('I_SalesOrganizationText'));
    const rows = s.standardRows('I_Product', 3);
    assert.equal(rows.rows.length, 3);
    assert.equal(rows.rows[0].Product, 'TG11');
    assert.throws(() => s.standardRows('kna1'), /Unknown view/);
  } finally { for (const w of s.workspaces.values()) w.close(); fs.rmSync(appsDir, { recursive: true, force: true }); }
});
