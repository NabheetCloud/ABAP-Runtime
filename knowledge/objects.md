# Every object kind the runtime supports — what to write, and a working sample to copy

All sources live in the app's `src/` (lower-case file names, abapGit layout). Paths below are relative to the RAP
Studio folder (the parent of this `knowledge` folder): `test/fixtures/*` are small, tested sample apps of the
runtime, `examples/*` the full example apps. Read the sample before writing a kind you have not written yet in this
app, and copy its shape.

## Catalog

| Kind | File in `src/` | Runs on | Sample to copy |
|---|---|---|---|
| Database table | `<ztab>.tabl.cds` (`define table`) | RAP + classic | `examples/travel/src` |
| Table (abapGit XML) | `<ztab>.tabl.xml` | RAP + classic | prefer `.tabl.cds` (`.INCLUDE` rows of the XML are expanded from the app's structures) |
| Structure | `<zs>.tabl.cds` with `define structure zs { comp : type; include zother; }` (no key, no client) | RAP + classic (types only, no database table) | `test/fixtures/po-classic/src/zpo_s_header.tabl.cds`; a component may be a structure or a table type (`items : zpo_t_items;`) |
| View entity / projection | `<name>.ddls.asddls` | RAP | `examples/travel/src` |
| Abstract entity (action parameter) | `<name>.ddls.asddls` (`define abstract entity`) | RAP | `examples/travel/src/za_rejectreason.ddls.asddls` |
| Custom entity + query class | `<name>.ddls.asddls` (`define custom entity`, `@ObjectModel.query.implementedBy: 'ABAP:ZCL_…'`) + class implementing `if_rap_query_provider` | RAP | `test/fixtures/custom/src/zce_flight.ddls.asddls`, `zcl_flight_query.clas.abap` |
| Table function + AMDP | `<name>.ddls.asddls` (`define table function … implemented by method zcl_x=>m`) + class with `if_amdp_marker_hdb` and `BY DATABASE FUNCTION` (SQLScript translated) | RAP | `test/fixtures/custom/src/ztf_carrierrevenue.ddls.asddls`, `zcl_flight_tf.clas.abap` |
| View with parameters | `define view entity … with parameters p : type` | RAP | `test/fixtures/custom/src/zi_flightbycity.ddls.asddls` |
| Hierarchy | `define hierarchy … as parent child hierarchy( source … child to parent association … start where … siblings order by … )` | RAP | `test/fixtures/language/src/zi_employeehier.ddls.asddls` |
| Metadata extension | `<name>.ddlx.asddlxs` | RAP | `examples/travel/src` |
| Behavior definition | `<name>.bdef.asbdef` | RAP | managed: `examples/travel`; unmanaged: `test/fixtures/unmanaged/src/zr_legacyorder.bdef.asbdef`; collaborative draft: `test/fixtures/collab`; change documents: `test/fixtures/docs/src/zr_doc.bdef.asbdef` |
| Behavior extension | `<name>.bdef.asbdef` starting `extension using interface …` / `extension for …` | RAP | `test/fixtures/docs/src/zr_doc_ext.bdef.asbdef` + `zbp_r_doc_ext.*` |
| Behavior pool | `zbp_<name>.clas.abap` + `.clas.locals_imp.abap` | RAP | `examples/travel/src` |
| Class | `<zcl>.clas.abap` (+ `.clas.locals_imp.abap` local classes, `.clas.locals_def.abap` local types, `.clas.macros.abap`, `.clas.testclasses.abap` ABAP Unit) | RAP + classic | `test/fixtures/custom/src/zcl_price_calc.clas.*` (with unit tests) |
| Interface | `<zif>.intf.abap` | RAP + classic | `INTERFACE zif_x PUBLIC. METHODS m … ENDINTERFACE.` |
| Exception class | `<zcx>.clas.abap` inheriting from `cx_static_check` / `cx_dynamic_check` / `cx_no_check` (resumable: `RAISE RESUMABLE EXCEPTION`) | RAP + classic | `test/fixtures/language/src/zcx_lang_resumable.clas.abap` |
| Service definition | `<zui>.srvd.srvdsrv` | RAP | every example |
| Access control | `<view>.dcls.asdcls` | RAP | `test/fixtures/secured/src/zr_sale.dcls.asdcls` (with `pfcg_auth`) |
| Message class | `<zmsg>.msag.json` `{ "001": "Text &1" }` | RAP + classic | (a `.msag.xml` in `src/` is ignored) |
| Simple transformation / XSLT | `<name>.xslt.source.xml` | RAP + classic | `test/fixtures/language/src/zlang_st.xslt.source.xml`, `zlang_html.xslt.source.xml` |
| Application job catalog / template | `<zjc>.sajc.json` / `<zjt>.sajt.json` + class with `if_apj_dt_exec_object` / `if_apj_rt_exec_object` | RAP | `test/fixtures/cloud/src` |
| Background process (bgPF) | class with `if_bgmc_op_single_tx_uncontr` | RAP | `test/fixtures/cloud/src/zcl_cloud_bgpf.clas.abap` |
| Events + local event handler | BDEF `event …` + class `FOR EVENTS OF` | RAP | `test/fixtures/unmanaged/src/zcl_legacyorder_events.*` |
| Print form | `<zform>.form.json` (+ images / `.ttf` in `src/`) | both | `knowledge/forms.md`, `examples/forms` |
| Report | `<zprog>.prog.abap` + `.prog.xml` (SUBC 1) | classic | `examples/classic/src/zcflight_report.*` |
| Module pool + screens + GUI status | `.prog.abap`, `.prog.xml` (SUBC M, DYNPROS, CUA), `.prog.screen_NNNN.abap` (flow logic) | classic | `knowledge/classic.md`, `examples/classic/src/zcflight_maint.*` |
| Transaction | `<ztcode>.tran.xml` | classic | `examples/classic/src/zcfl.tran.xml` |
| Function group / module | `<zgrp>.fugr.<fm>.abap`, `.fugr.l<zgrp>top.abap`, `.fugr.l<zgrp>f01.abap` | both | `examples/classic/src/zcfl.fugr.*`, `test/fixtures/types/src/ztyp.fugr.*` |
| Lock object | `e<zname>.enqu.xml` (ENQUEUE_/DEQUEUE_ function modules) | classic | `examples/classic/src/ezcflight.enqu.xml` (RAP uses BDEF locking instead) |
| Data element / domain / table type | `.dtel.xml`, `.doma.xml`, `.ttyp.xml` | RAP + classic (types) | `examples/classic/src/zcfl_*`, `test/fixtures/po-classic/src/zpo_*` |
| Form interface (classic Adobe form) | `<zfi>.sfpi.json` `{ "description": "…", "parameters": [{ "name": "IS_HEADER", "type": "ZPO_S_HEADER" }, { "name": "IT_ITEMS", "type": "ZPO_T_ITEM" }] }`, named by the form's `.form.json` `"interface"` | classic | see `knowledge/forms.md` |
| Search help / DDIC view | `.shlp.xml`, `.view.xml` | classic only, partial | |
| Seed data | `data/<ztab>.json` (array of rows) | both | loaded once into an empty table of this app |
| Fiori elements / freestyle UI5 app | `webapp/<app>/…` (`rap fiori …` generates) | RAP | see the main instructions |
| Destinations | `.rap/destinations.json` (outside `src/`) | RAP | see below |

Not written by you: service bindings and `package.devc.xml` (generated by `rap abapgit`), authorization objects
(roles and users come from `rap role` / `rap user`; authorization objects are just names in `AUTHORITY-CHECK` and
`pfcg_auth`).

## Pitfalls (the runtime does not fail loudly on these)

- **Types in RAP / CDS**: use built-in types (`abap.char(10)`, `abap.dec(15,2)`, `abap.dats`, …) or the common SAP
  data elements in tables and views. A Z data element from a `.dtel.xml` gets its domain's built-in type (also in
  RAP); CDS views and OData still see only the built-in type (no labels, no value help from the data element).
  Domain fixed values give no RAP value help: create a small `ZI_…` view (with `@ObjectModel.resultSet.sizeCategory: #XS`)
  and `@Consumption.valueHelpDefinition`.
- **`include` in a `.tabl.cds`** works for RAP, but such a table is not available to classic programs. Classic
  programs need the fields written out.
- **Virtual elements** (`virtual x : abap.char(10)`) are always initial (no calculation exit). Use a calculated
  element (`case … end as x`, `concat(…)`) or a custom entity.
- **BDEF `function`** and **`precheck`** are not run (activation warns). Use an action with `result [1] $self` or
  `result [0..*] <entity>`; check data in a validation.
- **CDS**: no `union`, no `right outer join`, no `extend view`, no `annotate … with parameters`; a calculated element
  needs `as <name>`.
- **Classic programs** (converter): rejected are `CALL TRANSACTION … USING` (batch input) inside a report (pass the
  values by `SET PARAMETER` / `SUBMIT … WITH`; from a class on the RAP runtime it works), dynamic `ASSIGN (name)`,
  dynamic `PERFORM (name)`, `LOOP` without a work area on header-line tables, some `WRITE` formatting additions and
  dynamic `WRITE` operands, a `CALL SCREEN` / `SUBMIT … AND RETURN` inside a loop (warning: the loop is not resumed).
  Standard function modules in reports: only those listed in `knowledge/classic.md`.
- **Access control**: `@AccessControl.authorizationCheck: #MANDATORY` with no role (`.dcls`) means nobody reads
  anything.

## Dictionary objects: what activation checks

- Domains / data elements: `DATATYPE` must be a DDIC type (CHAR, NUMC, DEC, CURR, QUAN, CUKY, UNIT, DATS, TIMS, INT1/2/4/8,
  FLTP, STRG, SSTR, RAW, RSTR, LANG, UTCL, DATN, TIMN, D16N, D34N, ACCP), `LENG` / `DECIMALS` numbers in range, fixed
  values not longer than the length (digits only for NUMC); a data element's `DOMNAME` must exist (Z names), labels at
  most 10 / 20 / 40 / 55 characters (`SCRTEXT_S/M/L`, `REPTEXT`).
- Table types: a Z `ROWTYPE` must be a structure, table or data element of the app (or another app of the system).
- Tables and structures: Z component types must exist, `include` structures too, an amount / quantity reference
  (`@Semantics.amount.currencyCode : 'ztab.waers'`, `@Semantics.quantity.unitOfMeasure : 'ztab.meins'`) must name a
  component, a check table (`with foreign key [0..*,1] zhead where … `) must exist.
- Table settings as annotations: `@AbapCatalog.deliveryClass : #A`, `@AbapCatalog.dataMaintenance : #RESTRICTED`, and
  (RAP Studio, exported as DD09L) `@AbapCatalog.technicalSettings.dataClass : #APPL1`, `.sizeCategory : 1`,
  `.buffering : #NOT_ALLOWED | #ALLOWED_BUT_OFF | #ON` (+ `.bufferingType : #SINGLE | #GENERIC | #FULL`). The runtime
  does not buffer.
Errors carry the line of the tag / component (Problems tab, `rap check`).

## Annotations that the runtime uses beyond the UI ones

`@Semantics.amount.currencyCode: 'Currency'`, `@Semantics.quantity.unitOfMeasure: 'Unit'` (formats and OData),
`@Consumption.hidden: true`, `@Consumption.defaultValue`, `@Consumption.mandatory` (action parameters),
`@Consumption.valueHelpDefinition`, `@EndUserText.label` / `quickInfo`, `@ObjectModel.text.element`,
`@ObjectModel.resultSet.sizeCategory: #XS` (drop-down), `@ObjectModel.query.implementedBy`,
`@ObjectModel.leadingEntity.name` (form data providers), `@AccessControl.authorizationCheck`.

## Released APIs: the details

**Destinations** — `.rap/destinations.json` of the app (never in `src/`, it may hold passwords):
```json
{ "ZWEATHER": { "url": "https://api.example.com", "user": "", "password": "", "headers": { "X-Key": "…" } } }
```
`cl_http_destination_provider=>create_by_cloud_destination( i_name = 'ZWEATHER' )`;
`create_by_comm_arrangement( comm_scenario = 'ZSCN' service_id = 'ZSRV_REST' )` looks up `"ZSCN/ZSRV_REST"`;
`create_by_url( i_url = 'https://…' )` needs nothing. Then `cl_web_http_client_manager=>create_by_http_destination( )`.

**Number ranges** — no number range object to create: the first `cl_numberrange_runtime=>number_get( nr_range_nr = '01'
object = 'ZORDER' )` creates interval 01 = 00000001…99999999. Own intervals:
`cl_numberrange_intervals=>create( interval = VALUE #( ( nrrangenr = '01' fromnumber = '1000' tonumber = '1999' ) ) object = 'ZORDER' )`
(the number has the length of `tonumber`); `read`, `delete`, `number_status`; `returncode = '1'` on the last number.

Keys from a number range when a record is created (RAP early numbering): in the BDEF
`define behavior for ZR_Employee alias Employee … lock master early numbering authorization master ( instance )
{ create; update; delete; field ( readonly ) EmployeeId; }`, and in the behavior pool:
```abap
METHODS earlynumbering_create FOR NUMBERING IMPORTING entities FOR CREATE Employee.
…
METHOD earlynumbering_create.
  LOOP AT entities INTO DATA(entity) WHERE EmployeeId IS INITIAL.
    TRY.
        cl_numberrange_runtime=>number_get( EXPORTING nr_range_nr = '01' object = 'ZHR_EMP'
                                            IMPORTING number = DATA(number) ).
        APPEND VALUE #( %cid = entity-%cid EmployeeId = number ) TO mapped-employee.   " EmployeeId: numc8 / char8
      CATCH cx_number_ranges INTO DATA(error).
        APPEND VALUE #( %cid = entity-%cid ) TO failed-employee.
        APPEND VALUE #( %cid = entity-%cid %msg = new_message_with_text( text = error->get_text( ) ) ) TO reported-employee.
    ENDTRY.
  ENDLOOP.
  " keys the caller already set stay as they are
  LOOP AT entities INTO entity WHERE EmployeeId IS NOT INITIAL.
    APPEND CORRESPONDING #( entity ) TO mapped-employee.
  ENDLOOP.
ENDMETHOD.
```
(`number` has the digits of the interval's `tonumber`, with leading zeros — 8 by default; give the key the same
length.) The projection BDEF needs nothing extra.

**Application jobs** — catalog `{ "formatVersion": "1", "header": { "description": "…", "originalLanguage": "en" },
"generalInformation": { "className": "ZCL_JOB" } }`, template the same with `"catalogName": "ZJC_…"`. The class:
`if_apj_dt_exec_object~get_parameters` (parameter definitions: `selname`, `kind` P / S, `datatype`, `length`,
`param_text`, `changeable_ind`) and `if_apj_rt_exec_object~execute` (`it_parameters` rows: `selname`, `kind`,
`sign`, `option`, `low`, `high`). Scheduling: `cl_apj_rt_api=>schedule_job( iv_job_template_name iv_job_text
is_start_info = VALUE #( start_immediately = abap_true ) it_job_parameter_value = VALUE #( ( name = 'P_TEXT' t_value =
VALUE #( ( sign = 'I' option = 'EQ' low = '…' ) ) ) ) IMPORTING ev_jobname ev_jobcount )`; periodic:
`is_scheduling_info-periodic_granularity` `MI` / `H` / `D` / `W` with `periodic_value`; `get_job_status`
(S scheduled, R running, F finished, A aborted, C cancelled), `cancel_job`, `get_job_runtime_info`.

**Mail** — `cl_bcs_mail_message=>create_instance( )`, `set_sender`, `add_recipient( iv_address = '…' iv_copy = 'C' | 'B' )`,
`set_subject`, `set_main( cl_bcs_mail_textpart=>create_instance( iv_content = … iv_content_type = 'text/html' ) )`,
`add_attachment( cl_bcs_mail_binarypart=>create_instance( … ) )`, `send( )`. Mails are not sent out: see them with
`rap system . mail_outbox`.

**Application log** — `cl_bali_log=>create_with_header( cl_bali_header_setter=>create( object = 'Z…' subobject = '…' ) )`,
`add_item( cl_bali_message_setter=>create( … ) / cl_bali_free_text_setter=>create( … ) / cl_bali_exception_setter=>create( … ) )`,
`cl_bali_log_db=>get_instance( )->save_log( )`, `load_log`, `delete_log`. `rap system .` lists the runtime's record
tables (jobs, logs, background processes, mail outbox, number ranges, output queue); `rap system . <table>` shows one.

**More** — `cl_abap_message_digest` and `cl_abap_hmac` (hashes, HMAC), `cl_web_http_utility` / `cl_http_utility`
(URL / base64 encoding), `cl_abap_conv_codepage` (UTF-8), `xco_cp` (dates, times, strings), `cl_abap_random_int`,
`OPEN DATASET` (files in the app's `.rap/files`), `EXPORT` / `IMPORT` to memory and database, cursors
(`OPEN CURSOR` / `FETCH`), RTTS (`cl_abap_typedescr` & co.), dynamic EML.
`docs/LANGUAGE-COVERAGE.md` lists the ABAP statements in detail.
