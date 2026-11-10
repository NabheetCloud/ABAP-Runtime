// Code checks (check variants in markdown, abaplint rules, the released-API check, quick fixes, explanations)
// and SAP's ABAP cleaner (skipped when it is not installed: npm run setup:abap-cleaner).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseVariant, runAtc, fixAtc, ruleDoc, listVariants } from '../src/check/atc.js';
import { cleanerAvailable } from '../src/check/cleaner.js';
import { Workspace } from '../src/server/server.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rap-atc-'));
after(() => fs.rmSync(dir, { recursive: true, force: true }));
const write = (f, s) => { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), s); };
write('src/zcl_quality.clas.abap', `CLASS zcl_quality DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    METHODS run RETURNING VALUE(r) TYPE string.
ENDCLASS.
CLASS zcl_quality IMPLEMENTATION.
  METHOD run.
    DATA lo TYPE REF TO zcl_quality.
    DATA lv_unused TYPE i.
    CREATE OBJECT lo.
    SELECT SINGLE name1 FROM kna1 WHERE kunnr = '0010100001' INTO @r.
    IF NOT lo IS INITIAL.
      r = r && '!'.
    ENDIF.
  ENDMETHOD.
ENDCLASS.
`);
write('src/zi_customers.ddls.asddls', `@AccessControl.authorizationCheck: #NOT_REQUIRED
define view entity ZI_Customers as select from kna1 { key kunnr as Customer, name1 as CustomerName }
`);

test('check variants are markdown: categories, checks, severity, settings; an app overrides rows', () => {
  const v = parseVariant('---\nname: T\n---\n## Performance\n\n| Check | Severity | Settings |\n|---|---|---|\n| db_operation_in_loop | warning | |\n| method_length | info | {"statements": 50} |\n');
  assert.equal(v.name, 'T');
  assert.deepEqual(v.rules.get('method_length'), { rule: 'method_length', severity: 'info', settings: { statements: 50 }, category: 'Performance' });
  assert.ok(listVariants().some(x => x.id === 'default' && x.checks > 40));
});

test('findings by category with severity, the released-API check names the successor, quick fixes apply', () => {
  const ws = new Workspace(dir, { lint: false, dbFile: ':memory:', systemDir: false });
  const known = ws.knownObjects();
  ws.close();
  const r = runAtc(dir, { knownObjects: known });
  const by = rule => r.findings.filter(f => f.rule === rule);
  assert.equal(by('released_api').length, 2);
  assert.match(by('released_api')[0].message, /KNA1 \(TABL\) is not released for ABAP Cloud: use I_CUSTOMER \(available in this system\)/);
  assert.equal(by('released_api')[0].category, 'ABAP Cloud readiness');
  assert.equal(by('unused_variables')[0].severity, 'warning');
  assert.ok(by('use_new')[0].fix);
  assert.ok(r.summary.fixable >= 2);
  const f = fixAtc(dir, {});
  assert.deepEqual(f.files, ['src/zcl_quality.clas.abap']);
  const src = fs.readFileSync(path.join(dir, 'src/zcl_quality.clas.abap'), 'utf8');
  assert.match(src, /lo = NEW #\( \)\./);
  assert.match(src, /IF lo IS NOT INITIAL\./);
  // the app's checks.md switches a check off
  write('checks.md', '## Robustness\n\n| Check | Severity |\n|---|---|\n| unused_variables | off |\n');
  assert.equal(runAtc(dir, { knownObjects: known }).findings.filter(x => x.rule === 'unused_variables').length, 0);
  fs.rmSync(path.join(dir, 'checks.md'));
});

test('Check of one object: unsaved editor text, only that object\'s findings', () => {
  const text = fs.readFileSync(path.join(dir, 'src/zcl_quality.clas.abap'), 'utf8').replace('ENDMETHOD.', 'ENDMETHD.');
  const r = runAtc(dir, { file: 'src/zcl_quality.clas.abap', overrides: { 'src/zcl_quality.clas.abap': text } });
  assert.ok(r.findings.length && r.findings.every(f => f.file === 'src/zcl_quality.clas.abap'));
  assert.ok(r.findings.some(f => f.severity === 'error' && f.rule === 'parser_error'));
  assert.ok(!runAtc(dir, { file: 'src/zcl_quality.clas.abap' }).findings.some(f => f.rule === 'parser_error'));
});

test('explanations: RAP Studio docs, abaplint documentation with the abapOpenChecks description', () => {
  assert.match(ruleDoc('released_api').markdown, /# Use released APIs/);
  const d = ruleDoc('if_in_if').markdown;
  assert.match(d, /# IF in IF/);
  assert.match(d, /abapOpenChecks CHECK_01/);
});

test('ABAP cleaner cleans the sources and keeps what activates', { skip: !cleanerAvailable() && 'ABAP cleaner not installed (npm run setup:abap-cleaner)', timeout: 120000 }, () => {
  write('src/zcl_messy.clas.abap', `CLASS zcl_messy DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    METHODS m RETURNING VALUE(r) TYPE i.
ENDCLASS.
CLASS zcl_messy IMPLEMENTATION.
  METHOD m.
  DATA lv_a TYPE i.
      lv_a = 1.
    IF lv_a = 1.
  r = lv_a.
    ENDIF.
  ENDMETHOD.
ENDCLASS.
`);
  const ws = new Workspace(dir, { lint: false, dbFile: ':memory:', systemDir: false });
  try {
    const r = ws.cleanUp('src/zcl_messy.clas.abap');
    assert.ok(r.ok);
    assert.deepEqual(r.files, ['src/zcl_messy.clas.abap']);
    assert.match(fs.readFileSync(path.join(dir, 'src/zcl_messy.clas.abap'), 'utf8'), /\n {4}DATA lv_a TYPE i\.\n\n {4}lv_a = 1\.\n {4}IF lv_a = 1\.\n {6}r = lv_a\./);
    assert.deepEqual(ws.app.diagnostics.errors, []);
  } finally { ws.close(); }
});

test('old statements are reported with their modern form, in classic programs too', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'rap-atc-modern-'));
  try {
    fs.mkdirSync(path.join(d, 'src'));
    fs.writeFileSync(path.join(d, 'src/zold.prog.abap'), `REPORT zold.
DATA lt TYPE string_table.
DATA ls TYPE string.
DATA lv TYPE string.
DATA n TYPE i.
READ TABLE lt INTO ls WITH KEY table_line = 'A'.
CONCATENATE lv ls INTO lv SEPARATED BY space.
TRANSLATE lv TO UPPER CASE.
DESCRIBE TABLE lt LINES n.
PERFORM run.
FORM run.
  WRITE / lv.
ENDFORM.
`);
    const r = runAtc(d);
    const modern = r.findings.filter(f => f.rule === 'modern_syntax');
    assert.deepEqual(modern.map(f => f.line), [6, 7, 8, 9, 11]);
    assert.ok(modern.every(f => f.severity === 'warning' && f.category === 'Modern ABAP syntax'));
    assert.match(modern[0].message, /table expression/);
    assert.match(modern[1].message, /string template/);
    assert.match(modern[4].message, /local class/);
    assert.match(ruleDoc('modern_syntax').markdown, /line_exists/);
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test('RAP handlers and event handlers are called by the framework: no unused findings, the quick fixes keep them', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'rap-atc-bp-'));
  try {
    const src = `CLASS lhc_item DEFINITION INHERITING FROM cl_abap_behavior_handler.
  PRIVATE SECTION.
    METHODS get_instance_features FOR INSTANCE FEATURES
      IMPORTING keys REQUEST requested_features FOR Item RESULT result.
    METHODS setDefaults FOR DETERMINE ON MODIFY
      IMPORTING keys FOR Item~setDefaults.
    METHODS validateQty FOR VALIDATE ON SAVE
      IMPORTING keys FOR Item~validateQty.
    METHODS on_done FOR EVENT finished OF cl_abap_timer_manager.
    METHODS helper.
ENDCLASS.
CLASS lhc_item IMPLEMENTATION.
  METHOD get_instance_features.
    result = VALUE #( FOR k IN keys ( %tky = k-%tky ) ).
  ENDMETHOD.
  METHOD setDefaults.
  ENDMETHOD.
  METHOD validateQty.
  ENDMETHOD.
  METHOD on_done.
  ENDMETHOD.
  METHOD helper.
  ENDMETHOD.
ENDCLASS.
`;
    fs.mkdirSync(path.join(d, 'src'));
    fs.writeFileSync(path.join(d, 'src/zbp_r_item.clas.locals_imp.abap'), src);
    fs.writeFileSync(path.join(d, 'src/zbp_r_item.clas.abap'), 'CLASS zbp_r_item DEFINITION PUBLIC ABSTRACT FINAL FOR BEHAVIOR OF zr_item.\nENDCLASS.\nCLASS zbp_r_item IMPLEMENTATION.\nENDCLASS.\n');
    const r = runAtc(d, {});
    const unused = r.findings.filter(f => /^unused_/.test(f.rule));
    assert.deepEqual(unused.map(f => f.message).filter(m => /setDefaults|validateQty|get_instance_features|on_done|requested_features/i.test(m)), []);
    fixAtc(d, {});
    const after = fs.readFileSync(path.join(d, 'src/zbp_r_item.clas.locals_imp.abap'), 'utf8');
    for (const m of ['get_instance_features FOR INSTANCE FEATURES', 'setDefaults FOR DETERMINE', 'validateQty FOR VALIDATE', 'requested_features', 'on_done FOR EVENT']) assert.ok(after.includes(m), m);
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test('function groups: SELECT * of a small table is fine there as in classes and reports (the group is known to the checks)', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'rap-atc-fg-'));
  try {
    fs.mkdirSync(path.join(d, 'src'));
    fs.writeFileSync(path.join(d, 'src', 'ztiny.tabl.cds'), `@EndUserText.label : 'Tiny'
@AbapCatalog.tableCategory : #TRANSPARENT
@AbapCatalog.deliveryClass : #A
define table ztiny {
  key client : abap.clnt not null;
  key id     : abap.char(10) not null;
  name       : abap.char(40);
}
`);
    fs.writeFileSync(path.join(d, 'src', 'ztiny_fg.fugr.z_tiny_get.abap'), `FUNCTION z_tiny_get.
*"----------------------------------------------------------------------
*"*"Local Interface:
*"  IMPORTING
*"     VALUE(IV_ID) TYPE  CHAR10
*"  EXPORTING
*"     VALUE(ES_ROW) TYPE  ZTINY
*"----------------------------------------------------------------------
  SELECT SINGLE * FROM ztiny WHERE id = @iv_id INTO @es_row.
ENDFUNCTION.
`);
    fs.writeFileSync(path.join(d, 'src', 'ztiny_rep.prog.abap'), `REPORT ztiny_rep.
DATA gs_row TYPE ztiny.
SELECT SINGLE * FROM ztiny WHERE id = 'A' INTO @gs_row.
WRITE gs_row-name.
`);
    const r = runAtc(d);
    assert.deepEqual(r.findings.filter(f => f.rule === 'select_performance').map(f => f.file), []);
    assert.equal(r.summary.error, 0, JSON.stringify(r.findings));
    assert.deepEqual(r.findings.map(f => f.file).filter(f => /\.fugr\.(sapl|l)\w*\.abap$|fugr\.xml/.test(f)), [], 'generated context is never reported');
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});
