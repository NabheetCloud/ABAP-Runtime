# Language coverage

This is what the runtime understands today, organised the way a RAP developer meets the language.
"Parsed" means the source is accepted and its meaning is kept; "executed" means the runtime behaves like ABAP.
Validated against SAP's [ABAP cheat sheets](https://github.com/SAP-samples/abap-cheat-sheets) (`node test/conformance.mjs`).
Syntax is additionally checked with [abaplint](https://github.com/abaplint/abaplint) against the ABAP Cloud grammar.

## ABAP (classes, executed)

**Program structure.** `CLASS … DEFINITION` (`PUBLIC`, `FINAL`, `ABSTRACT`, `INHERITING FROM`, `FOR BEHAVIOR OF`, `FOR TESTING`, `DEFERRED`, `LOCAL FRIENDS`), `CLASS … IMPLEMENTATION`, `INTERFACE`, sections, `INTERFACES`, `ALIASES`, `METHODS` / `CLASS-METHODS` with `IMPORTING / EXPORTING / CHANGING / RETURNING / RAISING`, `OPTIONAL`, `DEFAULT`, `REDEFINITION`, constructors and `class_constructor`, `super->`, `me->`, static access `=>`, interface components `intf~comp`, events (`EVENTS`, `RAISE EVENT`, `SET HANDLER`, `FOR EVENT`). A class and its `locals_def` / `locals_imp` includes are one compilation unit. AMDP methods that implement a CDS table function are translated (SQLScript → SQL); other AMDP methods are accepted but raise an exception when called.

**Types.** ABAP is statically typed, and so is the compiler: values are plain JavaScript values, and every
assignment converts into the declared type of its target (also into structure components): `c LENGTH n` is cut at
its length (a number is right-aligned with its sign position), `n` keeps the rightmost digits zero-padded, `x` / `xstring`
hold bytes, `p` rounds to its decimals and checks its length, `i` / `int8` check their range (`CX_SY_CONVERSION_OVERFLOW`,
`CX_SY_ARITHMETIC_OVERFLOW` for results of arithmetic), `f` is binary and `decfloat16/34` decimal (compared exactly).
Text into numbers follows the notations each type accepts (mathematical, commercial, scientific). Arithmetic has ABAP's
calculation type (decfloat > f > p > int8 > i, including the target; with `i` every intermediate result is an integer,
`**` is `f`), and inline declarations get that type, as does `cl_abap_typedescr=>describe_by_data`. Enumerated types
(`BEGIN OF ENUM … [STRUCTURE …] [BASE TYPE …]`), `cl_abap_math`, `round`/`rescale` with rounding modes,
`cl_abap_random*`, `cl_abap_bigint` and `cl_abap_rational`, and the `CX_SY` exception hierarchy as in ABAP.

**Declarations.** `DATA`, `CLASS-DATA`, `CONSTANTS`, `STATICS`, `TYPES`, `FIELD-SYMBOLS`, `BEGIN OF … END OF` (nested, `INCLUDE TYPE`), inline `DATA( )`, `FINAL( )`, `FIELD-SYMBOL( )`, `TYPE` / `LIKE`, `TYPE REF TO`, table types (`STANDARD / SORTED / HASHED TABLE OF … WITH … KEY`), `RANGE OF`, RAP derived types (`TABLE FOR …`, `STRUCTURE FOR …`, `RESPONSE FOR …`), CDS entities and database tables as types.

**Expressions.** Arithmetic `+ - * / DIV MOD **` (ABAP rounding and zero-division rules), `&&`, `&` literal concatenation, string templates with embedded expressions and the `ALPHA`, `DATE`, `CASE` and `DECIMALS` formatting options, substring access `dobj+off(len)`, table expressions `itab[ idx ]`, `itab[ comp = val … ]` with chaining, `->*`, and functional and chained method calls.
Constructor expressions: `VALUE` (structures, tables, `BASE`, `FOR … IN … [INDEX INTO] [WHERE]`, `FOR i = … UNTIL/WHILE`, `LET`, `LINES OF … FROM/TO`, `OPTIONAL`, `DEFAULT`), `CORRESPONDING` (`BASE`, `MAPPING`, `EXCEPT`, `DEEP`, `DISCARDING DUPLICATES`, `MAPPING FROM ENTITY` / `MAPPING TO ENTITY` `[USING CONTROL]`), `COND`, `SWITCH`, `CONV`, `NEW`, `REF`, `CAST`, `EXACT`, `REDUCE`, `FILTER`.
Built-in functions: `lines strlen numofchar condense to_upper to_lower to_mixed from_mixed abs ceil floor trunc frac sign sqrt round ipow nmax nmin cmax cmin concat_lines_of substring substring_after/before/from/to find count replace shift_left shift_right reverse repeat escape contains contains_any_of matches match segment insert translate xsdbool boolc line_exists line_index utclong_current`.

**Logical expressions.** `= <> < > <= >=` and `EQ NE LT GT LE GE`, `CS NS CP NP CO CN CA NA`, `IS [NOT] INITIAL / BOUND / ASSIGNED / SUPPLIED / INSTANCE OF`, `[NOT] IN range`, `[NOT] BETWEEN`, `AND OR NOT`, parentheses, predicative method calls.

**Control flow.** `IF/ELSEIF/ELSE`, `CASE/WHEN [OR]/OTHERS`, `DO [n TIMES]`, `WHILE`, `LOOP AT … INTO / ASSIGNING / REFERENCE INTO / TRANSPORTING NO FIELDS … FROM … TO … WHERE`, `LOOP AT … GROUP BY` (key structures, `GROUP SIZE`, `GROUP INDEX`, `ASCENDING/DESCENDING`, `INTO group`) and `LOOP AT GROUP`, `EXIT`, `CONTINUE`, `CHECK`, `RETURN`, `TRY/CATCH … INTO/CLEANUP/RETRY`, `RAISE EXCEPTION TYPE / NEW / obj`, `COND #( … THEN THROW … )`, `ASSERT`.

**Internal tables.** `APPEND` (`INITIAL LINE`, `LINES OF`, `ASSIGNING`, `REFERENCE INTO`), `INSERT` (`INTO TABLE`, `INDEX`, `LINES OF`, `ASSIGNING`), `MODIFY itab` (`INDEX`, `TRANSPORTING`, `WHERE`), `DELETE itab` (`WHERE`, `INDEX`, `TABLE … FROM / WITH TABLE KEY`, `ADJACENT DUPLICATES … COMPARING`), `READ TABLE` (`WITH KEY`, `WITH TABLE KEY`, `INDEX`, `BINARY SEARCH`), `SORT … BY … ASCENDING/DESCENDING`, `CLEAR`, `FREE`, `MOVE-CORRESPONDING`.

**Strings.** `CONCATENATE` (`SEPARATED BY`, `LINES OF`), `SPLIT … INTO TABLE / targets`, `CONDENSE [NO-GAPS]`, `TRANSLATE … TO UPPER/LOWER CASE`, `REPLACE [ALL OCCURRENCES OF] [REGEX/PCRE] … [IGNORING CASE]`, `REPLACE SECTION OFFSET … LENGTH … OF`, `FIND [ALL OCCURRENCES OF] [SUBSTRING/REGEX/PCRE] … MATCH COUNT/OFFSET/LENGTH, RESULTS, SUBMATCHES`.

**ABAP SQL** (translated to SQL; CDS view entities are real database views). `SELECT` in strict and classic syntax, `SINGLE`, `DISTINCT`, field lists, `*`, `tab~*`, `FIELDS`, joins, `WHERE` with host variables `@var` / `@( expr )`, `IN @range`, `IS [NOT] INITIAL`, aggregates, `GROUP BY`, `HAVING`, `ORDER BY`, `UP TO n ROWS`, `OFFSET`, `INTO / APPENDING [CORRESPONDING FIELDS OF] [TABLE] @target`, `INTO (@a, @b)`, `INTO NEW @DATA( )`, `FOR ALL ENTRIES IN` (including the empty-table rule), `SELECT … ENDSELECT`, `INSERT / UPDATE / MODIFY / DELETE` on database tables. `sy-subrc` and `sy-dbcnt` are set.

**EML.** `READ ENTITIES / READ ENTITY` (`ALL FIELDS`, `FIELDS ( … )`, `BY \assoc`, `RESULT`, `LINK`, `FAILED`, `REPORTED`), `MODIFY ENTITIES / MODIFY ENTITY` (`CREATE`, `CREATE BY \assoc`, `AUTO FILL CID`, `UPDATE`, `DELETE`, `EXECUTE … RESULT`, `FIELDS ( … ) WITH`, `SET FIELDS WITH`, `FROM` with `%control`, `MAPPED / FAILED / REPORTED`), `IN LOCAL MODE`, `COMMIT ENTITIES [RESPONSE OF … FAILED … REPORTED …]`, `ROLLBACK ENTITIES`, `SET LOCKS` (no-op).

**Released classes and interfaces.** `cl_abap_behavior_handler` (`new_message`, `new_message_with_text`), `cl_abap_behavior_saver`, `if_abap_behv` (`mk`, `fc`, `auth`, `cause`), `if_abap_behv_message`, `if_oo_adt_classrun` (+ `out->write`), `cl_abap_context_info`, `cl_system_uuid`, `cl_abap_char_utilities`, `cl_abap_random_int`, `cl_abap_tstmp`, and the `cx_*` exception hierarchy with `get_text( )`.

Also: dynamic EML (`MODIFY / READ ENTITIES OPERATIONS`), RTTS (`cl_abap_typedescr`, `cl_abap_structdescr`, `cl_abap_tabledescr`,
`cl_abap_elemdescr`, `CREATE DATA ... TYPE HANDLE`), `SHIFT`, `OVERLAY`, `CONVERT TIME STAMP / DATE / UTCLONG` with time zones,
`FIND / REPLACE ... IN TABLE`, `FIND ... IN SECTION`, `CALL TRANSFORMATION id` (asXML, JSON writer), `/ui2/cl_json`,
`RAISE RESUMABLE EXCEPTION` / `CATCH BEFORE UNWIND` / `RESUME`, `CLEANUP`, `CORRESPONDING ... APPENDING` and `... FROM itab USING`,
`FILTER ... IN ftab`, `READ TABLE ... FROM wa`, dynamic keys `[ ('COMP') = v ]`, `FOR ... FROM ... TO`, `REDUCE ... LET`, `EQUIV`,
`CALL METHOD ... PARAMETER-TABLE`, `SELECT ... WHERE (dynamic) ORDER BY (dynamic)`, `INTO (@a, @b)`, `PACKAGE SIZE`,
`INDICATORS NULL STRUCTURE`, `WITH PRIVILEGED ACCESS`, `AUTHORITY-CHECK`, `TEST-SEAM` / `TEST-INJECTION`, ABAP Unit
(`FOR TESTING`, `cl_abap_unit_assert`, `cl_osql_test_environment`, `cl_cds_test_environment`; run with `rap test`).

Also: data references that point at their data object (`REF #( )`, `GET REFERENCE OF`, `CREATE DATA`, `NEW` for data types,
`REFERENCE INTO`, `dref->*`, `dref->comp`), `FOR GROUPS ... GROUP BY` and `FOR ... IN GROUP`, ABAP SQL common table
expressions (`WITH +cte AS ( ... ) SELECT ...`, also as a loop with `ENDWITH`), SQL path expressions (`\_assoc-field`,
`\_assoc[ INNER WHERE ... ]-field`, `FROM view\_assoc`), `CALL TRANSFORMATION` with XSLT programs (XSLT 1.0 with XPath 1.0)
and simple transformations (serialization and deserialization) from `src/<name>.xslt.source.xml`, dynamic `SOURCE ( tab )` /
`RESULT ( tab )`, `RESULT JSON`, `MESSAGE eNNN(cls) [WITH ...] [INTO text]`, `THROW cx( MESSAGE ... | USING MESSAGE )`.

Also: ABAP memory and data clusters (`EXPORT` / `IMPORT` … `TO|FROM MEMORY ID`, `DATA BUFFER`, `INTERNAL TABLE`,
`DATABASE dbtab(ar) ID`, also with a parameter table `(ptab)`), `FREE MEMORY`, `DELETE FROM MEMORY|DATABASE`, SAP memory
(`SET` / `GET PARAMETER ID`), dynamic `ASSIGN (name)` (variables, components, `me->attr`, `cls=>attr`) with `ELSE UNASSIGN`,
dynamic components `struc-('COMP')`, `dref->('COMP')`, `itab[ … ]-('COMP')`, `CALL METHOD cls=>(name)` / `(cls)=>(name)`,
classic exceptions of methods (`RAISE name`, `EXCEPTIONS name = n | OTHERS = n`), `COLLECT`, `DELETE itab FROM i TO j`,
`INSERT dbtab FROM ( SELECT … )`, `IN CHARACTER|BYTE MODE`, `CALL TRANSFORMATION … SOURCE JSON`, ABAP SQL typed literals,
`CAST` and functions in the field list, `cl_abap_tstmp` / `cl_abap_utclong` / `utclong_add` / `utclong_diff`, and an XCO
core (`xco_cp=>sy`, `xco_cp_time` dates, times, moments, formats, date calculation, `xco_cp=>string`, the call stack).
Function groups also run on this runtime: each group is a class (`zfugr_<group>`) whose static methods are its
function modules and FORM routines and whose static attributes are the global data of its TOP include, so
`CALL FUNCTION` works from classes and RAP code (`EXPORTING`, `IMPORTING`, `CHANGING`, `TABLES`, `EXCEPTIONS … OTHERS`,
`MESSAGE … RAISING`, `PERFORM … USING … CHANGING`). The SAP LUW: `CALL FUNCTION … IN UPDATE TASK` and
`PERFORM … ON COMMIT` run at `COMMIT WORK`, `ROLLBACK WORK` drops them. Database cursors (`OPEN CURSOR`,
`FETCH NEXT CURSOR … PACKAGE SIZE`, `CLOSE CURSOR`) and files (`OPEN DATASET … FOR INPUT|OUTPUT|APPENDING`,
`TRANSFER`, `READ DATASET`, `CLOSE`/`DELETE DATASET`, kept in the app's `.rap/files`). Reports and transactions run
on the classic engine (selection screens, lists, dynpros), also when ABAP code here starts them: `SUBMIT rep WITH p = v
| WITH s IN rtab | WITH s BETWEEN a AND b | WITH SELECTION-TABLE rspar [EXPORTING LIST TO MEMORY] AND RETURN` (the list
with `LIST_FROM_MEMORY` and `LIST_TO_ASCI`) and `CALL TRANSACTION tc USING bdc_tab [MODE m] MESSAGES INTO msgs` (batch
input: `BDCDATA` screens, fields and `BDC_OKCODE`; `BDCMSGCOLL` messages). Without `USING`, a transaction needs a user
(the preview).
All 65 classes of SAP's ABAP cheat sheets compile and all 28 runnable ones run to the end (`npm run conformance:cheatsheets`).

**Released ABAP Cloud APIs** (`src/abap/cloud-apis.js`): `cl_abap_message_digest` (SHA-1/256/384/512, MD5, HMAC),
`cl_web_http_utility` / `cl_http_utility` (base64, UTF-8, URL and HTML escaping), `cl_abap_conv_codepage` (UTF-8,
Latin-1, UTF-16), number ranges (`cl_numberrange_runtime=>number_get` / `number_status`, `cl_numberrange_intervals`;
an object without intervals gets interval 01 from 1 to 99999999), application logs (`cl_bali_log`,
`cl_bali_header_setter`, free text / message / exception setters, `cl_bali_log_db` save / load / delete: the same tables
as the Logs page), the HTTP client (`cl_web_http_client_manager`, `cl_http_destination_provider` by URL or by name from
the app's `.rap/destinations.json`, requests with path, query, headers, text / binary / form body, basic and bearer
authorization) and e-mail (`cl_bcs_mail_message` with text and binary parts: sent into the app's outbox, table
`rap_mail_outbox` and `.rap/outbox/*.eml`), background processing (`cl_bgmc_process_factory`, operations with
`if_bgmc_op_single` / `if_bgmc_op_single_tx_uncontr` run after the commit of the transaction that registered them;
a rollback drops them; process monitor with its state) and application jobs (job catalog entries `src/<name>.sajc.json`
and templates `src/<name>.sajt.json` in the ABAP file format, classes with `if_apj_dt_exec_object` /
`if_apj_rt_exec_object`; `cl_apj_rt_api` schedule_job (now, at a time, periodic, with parameters), get_job_status,
cancel_job, get_job_runtime_info; a job's logs are linked to it). The studio runs due jobs every 5 seconds;
`rap appjobs <dir> [--run]` lists them and runs the due ones. The Data tab shows these records under System.

**Print forms (SAP Interactive Forms by Adobe)** (`src/abap/forms-apis.js`, engine `src/forms/`): the ABAP Cloud
output management APIs `cl_fp_form_reader=>create_form_reader` (get_layout, get_fdp_name), form data providers
`cl_fp_fdp_services=>get_instance( <service definition> )` (get_keys, read_to_xml, read_to_xml_v2: the leading entity of
the service, `@ObjectModel.leadingEntity.name`, with its children by composition or exposed association, as Adobe's
data XML), `cl_fp_ads_util=>render_pdf` (layout, data XML, locale; PDF, pages, trace) and the print queue
`cl_print_queue_utils=>create_queue_item_by_data`; the classic interface `FP_JOB_OPEN`, `FP_FUNCTION_MODULE_NAME`, the
generated function module `/1BCDWB/SM_<FORM>` (the interface parameters are the data; `/1BCDWB/DOCPARAMS` language and
country select the locale; `/1BCDWB/FORMOUTPUT` returns the PDF when `getpdf` is set, else it is printed) and
`FP_JOB_CLOSE`, with the DDIC structures `sfpoutputparams`, `sfpdocparams`, `fpformoutput`. The layout is JSON in place
of XDP (`src/<form>.form.json`): master pages (first-page header, header, footer, page x of y), page size,
orientation and margins, styles, text modules by language, watermarks, flowing text with inline bold, field lists,
tables (header repeated on every page, groups with subtotals, totals, stripes, currency formats), repeating
subforms, side-by-side columns, positioned boxes (address windows), PNG / JPEG images, barcodes (QR, Data Matrix,
PDF417, Aztec, MaxiCode, Code 128 / 39 / 93, GS1-128, EAN-13 / 8, UPC-A / E, ITF, Codabar via bwip-js), conditions,
keep-together and page breaks; dates, times and amounts follow the locale. Calculations in a FormCalc-like expression
language (variables, calculated columns, row-by-row table arithmetic). Drawn by our own PDF writer: standard fonts
or embedded TrueType subsets (any script), fillable fields (text, multi-line, check box, drop-down, signature; with
calculations recalculated in Acrobat / Reader), PKCS#7 signatures (signed when rendered or later), PDF/A-2b, AES-256
encryption with permissions. `cl_fp=>get_reference( )->create_pdf_object( )` extracts data, signs and verifies.
Adobe LiveCycle Designer XDP files are imported (`rap form import`): master pages, flowed and positioned subforms,
tables, repeating / optional subforms, breaks, JavaScript and FormCalc calculate / initialize / presence scripts
converted to expressions. Not supported: Adobe Reader run-time behaviour of XFA (adding rows with buttons, dialogs),
signing an encrypted PDF.

**Not yet supported**: XSLT 2.0 and XSLT extension functions.

## CDS (parsed and executed as SQL views)

`define table` (types `abap.*`, common data elements), abapGit `.tabl.xml`; `define [root] view entity` with `as select [distinct] from`, `as projection on`, `provider contract`, inner/left outer/cross joins, `association [card] to [parent] … on`, `composition [card] of`, exposed and redirected associations, path expressions `_assoc.field` (with `[ filter ]` parsed), `$projection`, `$session` variables, `where`, `group by`, `having`, `case` (simple and searched), `cast`, typed literals `abap.int4'1'`, arithmetic, `is [not] null`, `is [not] initial`, `like`, `between`, `in`. Functions: `concat`, `concat_with_space`, `substring`, `left`, `right`, `length`, `upper`, `lower`, `replace`, `coalesce`, `abs`, `round`, `ceil`, `floor`, `div`, `mod`, `division`, `count/sum/avg/min/max` (incl. `distinct`, `all`, `* `, `as type`), `dats_days_between`, `dats_add_days`, `dats_add_months`, `tstmp_current_utctimestamp`.
`define abstract entity`, `define custom entity` (served by an `if_rap_query_provider` class), `define table function`
(AMDP SQLScript method translated to SQL: `RETURN SELECT`, table variables, `:parameters`), `with parameters` (`$parameters.x`,
system field defaults, bound in `from X( p : ... )`, OData `Set(p=...)/Set`), `define hierarchy ... as parent child hierarchy`
(`$node.hierarchy_level / _rank / _tree_size / _parent_rank`, `node_id`, `parent_id`; an entity with `@OData.hierarchy.recursiveHierarchy`
answers the tree table requests `TopLevels`, `descendants`, `ancestors`), `annotate entity` (metadata extensions),
`define service … expose … as`, access controls `define role` (`.dcls.asdcls`: literal conditions, `aspect user`, `aspect pfcg_auth`,
`inheriting conditions from entity`), `$session.user`. `@Semantics.largeObject` elements are OData stream properties (attachments).
All annotations are parsed into a structured tree.

## BDEF (managed and unmanaged BOs executed, including draft, collaborative draft, late numbering and unmanaged save)

Also: `unmanaged implementation in class` (handlers `FOR MODIFY / READ / LOCK`, saver `finalize / check_before_save / save / cleanup`),
`etag master` (OData ETag / If-Match, 412) and `total etag` (checked on activation), `event Name [parameter P]` with
`RAISE ENTITY EVENT` and event handler classes `FOR EVENTS OF`, `with collaborative draft`, `changedocuments master ( obj )` /
`changedocuments dependent by _assoc` (field-level change log), behavior extensions (`extension ...; extend behavior for Alias { ... }`).

Header: `managed / unmanaged / projection / abstract / interface`, `implementation in class … unique`, `strict ( n )`, `with draft`, `with additional save`, `with unmanaged save`. Entity: `alias`, `persistent table`, `draft table`, `lock master / dependent by`, `authorization master ( instance | global ) / dependent by`, `etag master / dependent`, `total etag`, `early / late numbering`. Body: `create / update / delete ( features: instance )` (`precheck` is parsed but not run; activation warns), `function` (parsed, not run; activation warns), `field ( readonly, readonly:update, mandatory, mandatory:create, numbering:managed, features:instance, suppress )`, `association … { create; }`, `action / static action / factory action / internal action ( features: instance, authorization: none ) … parameter … result [card] $self|entity`, `determination … on modify|save { create; update; delete; field …; }`, `validation … on save { … }`, `determine action`, `mapping for … [corresponding] { … }`, `side effects { field … affects field … / field _assoc.… / entity …; action … affects $self; }`, `use …` in projections (incl. `use draft`, `use action Edit/Activate/…`), `draft action Edit / Activate [optimized] / Discard / Resume`, `draft determine action Prepare { validation …; }`, `draft table` (managed by the runtime), `total etag`.

Late numbering: preliminary keys (`%pid`, `%tmp`) until save; the saver's `adjust_numbers` fills the final keys in `mapped`,
and children are re-keyed. Unmanaged save (`managed with unmanaged save`, entity-level `with unmanaged save`) and
`with additional save`: the saver's `save_modified` receives `create` / `update` (with `%control`) / `delete` and writes
the tables with ABAP SQL.

Draft semantics: drafts belong to a user and lock the active instance for other users (expiry 15 minutes);
`%is_draft` in all keys and `%tky`; determinations on modify run on drafts; validations and determinations on save run on Prepare/Activate; Activate copies the draft tree into the active tables in one transaction; Edit copies active → draft; Discard deletes the draft tree.
