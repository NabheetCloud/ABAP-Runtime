# Classic ABAP programs: reports, module pools (dynpros), GUI status, DDIC objects

Classic programs run on the classic engine (the open-abap GUI host). They are abapGit files in `src/`. The complete
working samples are in `examples/classic/src` (relative to the RAP Studio folder, the parent of `knowledge`) — copy them: `zcflight_report` (report with a selection screen),
`zcflight_maint` (module pool: screen 0100, GUI status, transaction `ZCFL`), `zcflight_fm` (function module calls),
`zcflight_batch` (background job), `zcflight_print` (print form), `zcfl.fugr.*` (function group), `ezcflight.enqu.xml`
(lock object), `zcfl_carrier.doma.xml` / `.dtel.xml`, `zcfl_t_flights.ttyp.xml`.

## Report

`<zprog>.prog.abap` (the source) + `<zprog>.prog.xml`:
```xml
<PROGDIR><NAME>ZREPORT</NAME><SUBC>1</SUBC><RLOAD>E</RLOAD><FIXPT>X</FIXPT><UCCHECK>X</UCCHECK></PROGDIR>
<TPOOL>
 <item><ID>R</ID><ENTRY>Report title</ENTRY><LENGTH>12</LENGTH></item>
 <item><ID>S</ID><KEY>P_CARR</KEY><ENTRY>        Carrier</ENTRY><LENGTH>15</LENGTH></item>   <!-- selection text: 8 blanks, then the text -->
 <item><ID>I</ID><KEY>001</KEY><ENTRY>Text symbol</ENTRY><LENGTH>11</LENGTH></item>        <!-- TEXT-001 -->
</TPOOL>
```
Text elements live only in this TPOOL (`R` title, `S` selection texts with 8 leading blanks, `I` text symbols
`TEXT-001`); the engine reads them when it builds the program. A parameter or select-option without a selection text
shows the label of its dictionary type (`PARAMETERS p TYPE zdtel`, `SELECT-OPTIONS s FOR ztab-field`: `SCRTEXT_M`)
(inside the abapGit envelope `<abapGit …><asx:abap …><asx:values>…</asx:values></asx:abap></abapGit>`, as in the
sample). Selection screens: `PARAMETERS`, `SELECT-OPTIONS`, `SELECTION-SCREEN BEGIN OF BLOCK … WITH FRAME TITLE`,
radio buttons / check boxes, `AT SELECTION-SCREEN`, `START-OF-SELECTION`, lists with `WRITE`, ALV (below).

## Module pool

`.prog.xml` with `<SUBC>M</SUBC>`, the screens in `<DYNPROS>`, the GUI status in `<CUA>`; the flow logic of screen
NNNN in `<zprog>.prog.screen_NNNN.abap`; a transaction `<ztcode>.tran.xml` starts it (`TSTC-PGMNA`, `DYPNO`).

Screen (`DYNPROS/item`):
- `HEADER`: `PROGRAM`, `SCREEN` (0100), `LANGUAGE`, `DESCRIPT`, `TYPE` (N normal, I subscreen, M modal dialog),
  `NEXTSCREEN`, `LINES` / `COLUMNS`.
- `CONTAINERS/RPY_DYCATT`: `TYPE SCREEN NAME SCREEN` (and subscreen areas / table controls).
- Tabstrip: a container `TYPE STRIP_CTRL` (`ELEMENT_OF SCREEN`, line, column, length, height), a `TYPE SUBSCREEN` area with
  `ELEMENT_OF <strip>`, and per tab a `PUSH` field with `CONT_TYPE STRIP_CTRL`, `CONT_NAME <strip>`, `PUSH_FCODE <tab>`;
  each tab's subscreen is a screen of `TYPE I`. Program: `CONTROLS ts TYPE TABSTRIP.`, a `sy-dynnr` field with the shown
  subscreen; PBO `CALL SUBSCREEN sub_ts INCLUDING sy-repid gv_dynnr.`, PAI `CALL SUBSCREEN sub_ts.` and a module (before
  the one that clears the OK code) that sets `ts-activetab` and the subscreen from the tab's function code. The screen
  painter's "+ Tabstrip" writes all of it.
- Selection texts with a dictionary reference: TPOOL `S` entry `D       .` (the data element's medium label is shown).
- `FIELDS/RPY_DYFATC`, one per element: `CONT_TYPE`, `CONT_NAME`, `TYPE`, `NAME`, `TEXT`, `LINE`, `COLUMN`, `LENGTH`,
  `VISLENGTH`, `HEIGHT`, `FORMAT` (CHAR, NUMC, DATS, DEC, …), and by type:

| `TYPE` | Element | Attributes |
|---|---|---|
| `TEXT` | label | `TEXT` |
| `TEMPLATE` | input / output field (the global variable `NAME`) | `INPUT_FLD X`, `OUTPUT_FLD X`, `REQU_ENTRY R` (required), `DROPDOWN L` or `K` (list box; values from `VRM_SET_VALUES` or the domain's fixed values), `INVISIBLE`, `BRIGHT` |
| `FRAME` | group box | `TEXT` |
| `PUSH` | push button | `PUSH_FCODE` (the function code), `ICON_NAME` |
| `CHECK` | check box | |
| `RADIO` | radio button (same group: consecutive radio buttons) | |
| `LISTBOX` | drop-down list | as `TEMPLATE` with `DROPDOWN L` |
| `SUBSCREEN` | subscreen area | |
| `OKCODE` | the OK code field (last element, `NAME OK_CODE`) | |

Flow logic (`.prog.screen_NNNN.abap`):
```abap
PROCESS BEFORE OUTPUT.
  MODULE status_0100.                       " SET PF-STATUS 'MAIN'. SET TITLEBAR '100'.
  CALL SUBSCREEN area INCLUDING sy-repid '0200'.
  LOOP AT gt_items INTO gs_item WITH CONTROL tc_items.
  ENDLOOP.
PROCESS AFTER INPUT.
  MODULE exit_0100 AT EXIT-COMMAND.         " function type E codes (BACK / EXIT / CANCEL)
  CHAIN.
    FIELD gv_carrier MODULE check_carrier ON REQUEST.   " an error message keeps the fields open
  ENDCHAIN.
  MODULE user_command_0100.
PROCESS ON VALUE-REQUEST.
  FIELD gv_carrier MODULE f4_carrier.       " F4IF_INT_TABLE_VALUE_REQUEST
```
Screen fields can be components of a global structure or a `TABLES` work area (`GS_HEAD-EBELN`, `ZPO_HEAD-LIFNR`):
PBO shows them and PAI moves the input back into the component. Value help (F4) needs no code: a screen field,
parameter or select-option typed by a table field with a check table (`with foreign key`), or by a data element whose
domain has fixed values or a value table, gets a value-help pop-up automatically; write `PROCESS ON VALUE-REQUEST` only
for a custom list. ALV column headings are the medium field label of
the column's data element (then the long, the short one), unless the program set a text. A module `ON REQUEST` runs only when one of its fields
(or of its CHAIN) was changed on the screen.
`CALL SCREEN`, `LEAVE TO SCREEN`, `SET SCREEN`, `LEAVE PROGRAM`, `MESSAGE … TYPE 'E' / 'W' / 'I' / 'S'`.

GUI status (`CUA`): `ADM` (ACTCODE, PFKCODE), `STA/RSMPE_STAT` (`CODE` MAIN, `MODAL` D, …), `FUN/RSMPE_FUNT` (`CODE`,
`TEXTNO`, `TYPE` E for exit commands, `TEXT_TYPE` S, `FUN_TEXT`), `PFK` (function keys: F3 BACK, F12 CANCEL, …), `SET`
(status → functions), `BUT` (toolbar buttons), `TIT` (titles: `CODE` 100, `TEXT`). Copy `zcflight_maint.prog.xml`.

## Standard function modules available in programs

`POPUP_TO_CONFIRM`, `POPUP_TO_INFORM`, `POPUP_GET_VALUES`, `POPUP_WITH_TABLE_DISPLAY`, `POPUP_TO_SELECT_MONTH`,
`F4IF_INT_TABLE_VALUE_REQUEST`, `VRM_SET_VALUES`, `VRM_REFRESH_VALUES`, `LVC_FIELDCATALOG_MERGE`,
`REUSE_ALV_FIELDCATALOG_MERGE`, `REUSE_ALV_GRID_DISPLAY`, `REUSE_ALV_LIST_DISPLAY`, `REUSE_ALV_HIERSEQ_LIST_DISPLAY`,
`REUSE_ALV_BLOCK_LIST_INIT` / `_APPEND` / `_DISPLAY`, `REUSE_ALV_POPUP_TO_SELECT`, `REUSE_ALV_EVENTS_GET`,
`REUSE_ALV_VARIANT_F4`, `REUSE_ALV_COMMENTARY_WRITE`, `SELECT_OPTIONS_RESTRICT`, `FREE_SELECTIONS_INIT` /
`_DIALOG` / `_RANGE_2_WHERE`, `RS_REFRESH_FROM_SELECTOPTIONS`, `RS_VARIANT_CATALOG`, `RS_VARIANT_CONTENTS`,
`RS_CREATE_VARIANT`, `RS_CHANGE_CREATED_VARIANT`, `RS_VARIANT_DELETE`, `SCMS_XSTRING_TO_BINARY`, `DP_CREATE_URL`,
`DP_PUBLISH_WWW_URL`; the job function modules `JOB_OPEN` / `JOB_SUBMIT` / `JOB_CLOSE`; the form function modules
(`FP_JOB_OPEN`, …); the app's own function modules and lock objects (`ENQUEUE_E…` / `DEQUEUE_E…`). Other standard
function modules are reported by the check. `cl_salv_table` ALV is available too.

## Print programs (Adobe forms)

`FP_JOB_OPEN` (`ie_outputparams`), `FP_FUNCTION_MODULE_NAME` (the form's generated function module `/1BCDWB/SM…`, its
parameters are the form interface), the generated function module, `FP_JOB_CLOSE`. With `ie_outputparams-getpdf = 'X'`
the PDF goes back to the program in `/1bcdwb/formoutput-pdf` (and `-pages`) and is not an output request; the page of
that run (list or screen) also shows a "PDF returned to the program" link that opens it (`/__rap/preview/<n>.pdf`, the
last 30 kept). Without `getpdf` the forms of one job are one output request in the output queue (Output page,
`e_result-spoolids`).

## Classes, locks and errors in a classic app

- A class with `if_oo_adt_classrun` (console, Run/F9) runs on the RAP runtime, also in a classic app. There it can
  call the app's function modules and the lock function modules `ENQUEUE_E…` / `DEQUEUE_E…` of the app's lock
  objects. Both engines share the lock table of the app's database: a lock held by a transaction is a `FOREIGN_LOCK`
  for the console run and the other way round. The locks of a console run end with it. Classes called from reports,
  module pools and function modules run on the classic engine.
- Activate converts and transpiles the classic programs too: a statement the classic engine cannot run is an error in
  the activation result and in Problems (file and line), and Run of that program shows the errors.
- An exception no code catches is a runtime error: the page names the statement, and Problems → Runtime errors keeps
  it with the ABAP call stack and the source around it.
- System fields belong to the program's session: `sy-dbcnt`, `sy-subrc`, `sy-tabix`, `sy-index`, `sy-fdpos` keep the
  values of the session's last dialog step (as on SAP, where they belong to the internal session), and a new
  session starts with initial ones.
- A screen field whose program field is a date or a time (also a component of a dictionary structure) is a date / time
  field whatever FORMAT the painter set: blank when initial, the date in the user's format.
- The user's date format is DD.MM.YYYY on every page: screens, selection screens, WRITE lists, the ALV grid and
  `|{ d DATE = USER }|`. An initial date is blank on screens, in lists and in the grid.
- A parameter or a screen field typed with a data element whose domain has fixed values offers them as a
  value list (with their texts) while typing.

## Not converted (the check reports them)

`CALL TRANSACTION … USING` (batch input) inside a program — pass values with `SET PARAMETER ID` / `SUBMIT … WITH`;
dynamic `ASSIGN (name)` and `PERFORM (name)`; `LOOP` over header-line tables without a work area; some `WRITE`
formatting additions and dynamic `WRITE` operands; `CALL SCREEN` / `SUBMIT … AND RETURN` inside a loop.

## DDIC objects (classic programs; RAP uses `.tabl.cds` and built-in types)

- Domain `<zdom>.doma.xml`: `DD01V` (`DOMNAME`, `DATATYPE` CHAR / NUMC / DEC / DATS / …, `LENG`, `DECIMALS`,
  `OUTPUTLEN`, `VALEXI X` with fixed values, `DDTEXT`), fixed values in `DD07V_TAB/DD07V` (`DOMVALUE_L`, `DDTEXT`).
- Data element `<zdtel>.dtel.xml`: `DD04V` (`ROLLNAME`, `DOMNAME` or `DATATYPE` / `LENG`, `SCRTEXT_S/M/L`, `REPTEXT`,
  `DDTEXT`).
- Table type `<zttyp>.ttyp.xml`: `DD40V` (`TYPENAME`, `ROWTYPE`, `ACCESSMODE` T / S / H, `KEYDEF`).
- Lock object `e<zname>.enqu.xml`: `DD25V` (`VIEWNAME`, `ROOTTAB`), `DD26E_TAB` (tables), `DD27P_TAB` (lock
  parameters) → `ENQUEUE_E<ZNAME>` / `DEQUEUE_E<ZNAME>`.
Copy the samples in `examples/classic/src`; they open as readable forms in the studio.
