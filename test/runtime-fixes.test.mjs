// Runtime behaviour found by apps built from the chat: dynamic SORT, LOOP ... STEP, escape( ) formats, and a key from
// early numbering on a read-only key field.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Workspace } from '../src/server/server.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rap-fixes-'));
const src = (f, t) => { fs.mkdirSync(path.join(dir, 'src'), { recursive: true }); fs.writeFileSync(path.join(dir, 'src', f), t); };
src('zcl_probe.clas.abap', `CLASS zcl_probe DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES if_oo_adt_classrun.
    TYPES: BEGIN OF ty_row, dept TYPE c LENGTH 4, avg TYPE p LENGTH 15 DECIMALS 2, END OF ty_row,
           tt_row TYPE STANDARD TABLE OF ty_row WITH EMPTY KEY.
ENDCLASS.
CLASS zcl_probe IMPLEMENTATION.
  METHOD if_oo_adt_classrun~main.
    DATA(rows) = VALUE tt_row( ( dept = 'IT' avg = '20' ) ( dept = 'HR' avg = '50' ) ( dept = 'FIN' avg = '30' ) ).
    DATA(field) = \`AVG\`.
    SORT rows BY (field) DESCENDING.
    out->write( |{ rows[ 1 ]-dept }{ rows[ 2 ]-dept }{ rows[ 3 ]-dept }| ).
    DATA(lower) = \`dept\`.
    SORT rows BY (lower).
    out->write( |{ rows[ 1 ]-dept }{ rows[ 2 ]-dept }{ rows[ 3 ]-dept }| ).
    DATA otab TYPE abap_sortorder_tab.
    otab = VALUE #( ( name = 'AVG' descending = abap_true ) ).
    SORT rows BY (otab).
    out->write( |{ rows[ 1 ]-dept }{ rows[ 2 ]-dept }{ rows[ 3 ]-dept }| ).
    DATA result TYPE string.
    LOOP AT rows INTO DATA(r) STEP -1.
      result = result && r-dept.
    ENDLOOP.
    out->write( result ).
    CLEAR result.
    LOOP AT rows INTO r STEP 2.
      result = result && r-dept.
    ENDLOOP.
    out->write( result ).
    out->write( escape( val = \`<a & "b">\` format = cl_abap_format=>e_html_text ) ).
    out->write( escape( val = \`a'b\` format = cl_abap_format=>e_html_attr ) ).
    out->write( escape( val = \`a b&c\` format = cl_abap_format=>e_url ) ).
    out->write( escape( val = \`say "hi"\` format = cl_abap_format=>e_json_string ) ).
  ENDMETHOD.
ENDCLASS.
`);
// a business object whose key comes from a number range (early numbering) and is read-only for the caller
src('zemp_a.tabl.cds', `define table zemp_a {
  key client : abap.clnt not null;
  key emp_id : abap.numc(8) not null;
  name : abap.char(40);
}
`);
src('zr_emp.ddls.asddls', `define root view entity ZR_Emp as select from zemp_a {
  key emp_id as EmpId,
  name as Name
}
`);
src('zr_emp.bdef.asbdef', `managed implementation in class zbp_r_emp unique;
strict ( 2 );
define behavior for ZR_Emp alias Emp
persistent table zemp_a
lock master
early numbering
authorization master ( global )
{
  create; update; delete;
  field ( readonly ) EmpId;
  mapping for zemp_a { EmpId = emp_id; Name = name; }
}
`);
src('zbp_r_emp.clas.abap', 'CLASS zbp_r_emp DEFINITION PUBLIC ABSTRACT FINAL FOR BEHAVIOR OF zr_emp.\nENDCLASS.\nCLASS zbp_r_emp IMPLEMENTATION.\nENDCLASS.\n');
src('zbp_r_emp.clas.locals_imp.abap', `CLASS lhc_emp DEFINITION INHERITING FROM cl_abap_behavior_handler.
  PRIVATE SECTION.
    METHODS get_global_authorizations FOR GLOBAL AUTHORIZATION IMPORTING REQUEST requested_authorizations FOR Emp RESULT result.
    METHODS earlynumbering_create FOR NUMBERING IMPORTING entities FOR CREATE Emp.
ENDCLASS.
CLASS lhc_emp IMPLEMENTATION.
  METHOD get_global_authorizations.
  ENDMETHOD.
  METHOD earlynumbering_create.
    LOOP AT entities INTO DATA(entity) WHERE EmpId IS INITIAL.
      cl_numberrange_runtime=>number_get( EXPORTING nr_range_nr = '01' object = 'ZEMP' IMPORTING number = DATA(number) ).
      APPEND VALUE #( %cid = entity-%cid EmpId = number ) TO mapped-emp.
    ENDLOOP.
  ENDMETHOD.
ENDCLASS.
`);
src('zui_emp.srvd.srvdsrv', 'define service ZUI_EMP { expose ZR_Emp as Emp; }\n');
const ws = new Workspace(dir, { ...(process.env.RAP_DB ? { dbUrl: process.env.RAP_DB } : { dbFile: ':memory:' }), lint: false });
after(() => ws.close());
const call = (m, u, b) => { try { return ws.odata.handle(m, u, b); } catch (e) { return { status: e.status || 500, body: { error: e.message } }; } };

test('dynamic SORT by a name or an abap_sortorder_tab, LOOP AT ... STEP, escape( ) with CL_ABAP_FORMAT', () => {
  assert.deepEqual(ws.app.diagnostics.errors, []);
  const r = ws.runClass('zcl_probe');
  assert.ok(r.ok, r.error);
  assert.deepEqual(r.output.split('\n'), ['HRFINIT', 'FINHRIT', 'HRFINIT', 'ITFINHR', 'HRIT', '&lt;a &amp; "b"&gt;', 'a&#39;b', 'a%20b%26c', 'say \\"hi\\"']);
});

test('early numbering fills a read-only key; the caller still cannot set it', () => {
  const c = call('POST', '/odata/zui_emp/Emp', { Name: 'Anna' });
  assert.equal(c.status, 201, JSON.stringify(c.body));
  assert.equal(c.body.EmpId, '00000001');
  assert.equal(call('POST', '/odata/zui_emp/Emp', { Name: 'Ben' }).body.EmpId, '00000002');
  assert.equal(call('POST', '/odata/zui_emp/Emp', { EmpId: '00000099', Name: 'Eve' }).status, 400);
});
