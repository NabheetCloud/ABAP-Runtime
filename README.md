# RAP Studio — an open runtime for SAP RAP applications

Build, run and change **end-to-end RAP / SAP Fiori applications without an SAP server**, by chatting or by hand.
You (or the AI agent) write standard ABAP RAP sources: CDS, behavior definitions, behavior pools, projections,
metadata extensions and service definitions. RAP Studio activates them on Node.js, stores data in **SQLite or
PostgreSQL**, and serves real **OData V4**. Real **SAP Fiori elements** and **SAPUI5** apps run against it.
The sources stay in **abapGit layout**, so the same files can later be pulled into SAP BTP ABAP environment or S/4HANA.

```
apps/<app>/                             one folder per application
  CLAUDE.md                             platform rules for the AI agent
  src/ztravel_a.tabl.cds                define table ...                     (or abapGit .tabl.xml)
  src/zr_travel.ddls.asddls             define root view entity ... composition / association
  src/zr_travel.bdef.asbdef             managed behavior definition with draft, side effects, actions
  src/zbp_r_travel.clas.locals_imp.abap behavior handlers (determinations, validations, actions, features)
  src/zc_travel.ddls.asddls / .bdef     projection layer
  src/zc_travel.ddlx.asddlxs            @UI annotations (metadata extension)
  src/zui_travel.srvd.srvdsrv           service definition
  data/*.json                           seed data
  webapp/<ui>/                          SAP Fiori elements / SAPUI5 apps
  .rap/                                 the app's database (not part of the sources)
```

## What is supported

| Area | What you can build, run and debug |
|---|---|
| **RAP** | managed and unmanaged business objects, draft and collaborative draft with locks, early and late numbering, unmanaged / additional save, determinations, validations, actions, side effects, feature control, authorizations, ETags, business events, change documents, behavior extensions, custom entities, CDS parameters, table functions, hierarchies, access controls, attachments, ABAP Unit |
| **OData and UI** | OData V4 (with `$batch`, `$apply`, draft protocol) and OData V2 at the SAP Gateway URL; SAP Fiori elements (List Report / Object Page, Worklist, Analytical List Page, Overview Page, Flexible Programming Model) and freestyle SAPUI5 apps |
| **Dictionary, by hand** | domains (fixed values, value tables, CURR / QUAN), data elements with or without a domain, structures, table types, database tables (field grid, check tables, currency / quantity references, technical settings), lock objects, message classes, exception classes (T100) |
| **Classic programs, by hand** | reports (selection screens, text elements, `WRITE` lists with colors, ALV), function groups and function modules (parameter editor, test page like SE37), module pools (screen painter with dictionary field picker, table-control and tabstrip wizards, GUI status, transactions), classes used from all of them, lock objects with `ENQUEUE_`/`DEQUEUE_`, background jobs, application logs |
| **Print forms** | SAP Adobe forms: form interfaces, a visual layout designer, Adobe LiveCycle XDP import, live PDF preview, print programs (`FP_JOB_OPEN` / form function module / `FP_JOB_CLOSE`) and the ABAP Cloud form APIs, output queue |
| **Developer tools** | debugger (breakpoints in classes, reports, FORMs, function modules and PAI modules; step into / over / return; watches; variables, call stack, system fields), runtime errors like ST22, SQL trace like ST05, code checks like ATC, SAP's ABAP cleaner, data preview like SE16 |
| **System** | SQLite or PostgreSQL, apps that share master data like one SAP system, an S/4HANA standard layer (341 tables, 202 released views, with data), users, roles and authorizations, abapGit export |
| **Learning** | Practice ABAP: 54 exercises with ABAP Unit tests, checks and clean-up |

Everything runs on your machine with Node.js: no SAP server and no cloud account. The sections below give
the details.

## Quick start

You need Node.js 22.5 or later and git. Tested on macOS and Linux; on Windows use WSL.

```bash
git clone https://github.com/NabheetCloud/ABAP-Runtime.git
cd ABAP-Runtime
npm install
npm run setup
npm run studio
```

`npm run setup` installs the classic ABAP engine (reports, module pools, function modules) once. Open
http://localhost:4004: open one of the demo apps (Travel, Purchase orders, Classic ABAP Showcase, …), start a blank app
and build it by hand, or describe an app to the build agent (needs the Claude Code CLI, see below).

Or without cloning: `npx rap-studio` (then `npx rap-studio setup` for the classic engine).

The chat (describing an app to the build agent) needs the Claude Code CLI installed and logged in on this machine; see
[Building by chat](#building-by-chat-with-your-local-claude-code-cli). Building by hand needs nothing else.

The studio listens on this machine only (127.0.0.1). To reach it from other machines, create an administrator and
start it with `--host 0.0.0.0`; see [SECURITY.md](SECURITY.md).

## Building by chat (with your local Claude Code CLI)

> **For now the chat works only with a local Claude Code CLI.** The build agent behind the chat (new-app prompts, the
> app chat, "Fix with AI") is the [Claude Code](https://docs.anthropic.com/en/docs/claude-code) command line tool,
> installed on your machine and logged in to your own account; RAP Studio starts it for you and uses your account.
> Without it everything else works: build apps by hand with **+ New**, run, debug, check and preview them. Other agents
> are not supported yet. If `claude` is not on your PATH, set `RAP_CLAUDE_BIN` to its full path.

1. The studio creates `apps/<name>/` with a `CLAUDE.md` that teaches the agent the platform rules and points it at the
   reference app (`examples/travel`).
2. It runs your **local Claude Code CLI** headless in that folder (`claude -p … --output-format stream-json`, continuing the
   conversation with `--resume`). The CLI may only edit files and run the platform's own commands: `rap check` (activation +
   abaplint), `rap run` (console classes), `rap fiori` (generate Fiori apps) and `rap odata` (calls the app's OData service on the local studio).
3. Every step streams into the chat: plan, files created and edited, checks run.
   Attach documents and screenshots to any message (📎, paste or drag and drop: images, PDFs, Word, Excel, PowerPoint,
   text files; up to 10 files of 25 MB). They are kept in the app's `.rap/attachments`; the agent reads them with the
   message (Office files as extracted text): specifications for the requirements, mockups and screenshots for what to
   build, screenshots of errors for what to fix.
4. Every file change re-activates the app. The workbench tabs are **Preview** (the running app: the built-in UI, generated
   Fiori elements apps, UI5 apps), **Code** (Monaco: ABAP, CDS, BDEF, UI5 XML/JS; editable), **Problems** (compiler and
   abaplint findings, with "Fix with AI"), **Data** (tables and views) and **Console** (`if_oo_adt_classrun`).
5. **Download** returns the app as a zip of abapGit-layout sources.

Example result: the prompt "a library app to manage books and loans…" produced 17 RAP objects with 0 errors in about 4 minutes.
A follow-up "add an optional, validated member email" changed tables, views, BDEF, handler, message class and annotations,
and migrated the existing data in place.

## SAP Fiori elements and SAPUI5

Each service is a full OData V4 service at `/a/<app>/odata/<service>/`:

- `$metadata` (EDMX) with `UI`, `Common`, `Capabilities`, `Aggregation`, `Measures` annotations generated from CDS
  annotations and the BDEF. That covers line items, facets, field groups, selection fields, header info, value lists,
  text arrangements, currencies, side effects, draft root/node, operation availability from instance feature control,
  insert/update/delete restrictions, charts and aggregation.
- `$batch` (multipart with atomic change sets and Content-ID references, and JSON batch), `$apply`
  (`filter`, `groupby`, `aggregate`; `$filter` applies to its result, as OData V4 defines), `$filter`, `$search`, `$expand` with nested options, `$count`, `/$count`.
- The **draft protocol**: `IsActiveEntity`, `HasDraftEntity`, `SiblingEntity`, `DraftAdministrativeData`, and the
  Edit / Prepare / Activate / Discard / Resume actions.

Generate a Fiori elements app (or use **+ Fiori app** in the studio's Preview tab):

```bash
node bin/rap.js fiori apps/travel --template lrop --service zui_travel --entity Travel --name travel-fe
```

| Template | Verified in the browser |
|---|---|
| `lrop` List Report + Object Page | list with draft editing-status filter, value helps, actions enabled per instance; object page with facets; Edit → draft → live recalculation via side effects → Save (Prepare + Activate) |
| `worklist` | list without filter bar |
| `alp` Analytical List Page | chart + table from `$apply`, measures from `@Aggregation.default`, chart from `@UI.chart` |
| `fpm` Flexible Programming Model | custom XML view with FilterBar / Table building blocks |
| `ovp` Overview Page | runs in the SAP Fiori launchpad sandbox; list and table cards from `@UI.lineItem`, analytical chart cards from `@UI.chart`, global filter bar |
| `freestyle` SAPUI5 | your own UI as a real component: list and detail pages with routing, search, the composition child table and action buttons, generated from the annotations as a starting point |

Every UI, Fiori elements or freestyle, is an SAPUI5 component: `Component.js`, `manifest.json` (OData V4 data source and
default model, routing), i18n, and an `index.html` that only starts the component (`sap/ui/core/ComponentSupport`).
The studio's Preview opens the app's own UI5 app. The lightweight built-in UI is still there as "Built-in data browser".

When you describe a new app and do not say which UI you want, the chat asks: **SAP Fiori elements** or **freestyle
SAPUI5**? If you pick Fiori elements, it asks which template. The same happens in the app chat when you ask for a new UI.
The agent then generates that app.

Freestyle UI5 apps go in `webapp/<ui>/`. For example, `apps/travel/webapp/travels` is a component whose view calls the
RAP action `acceptTravel`.

## Where is the data saved?

Every app has its own database. You choose it with `--db` (or the `RAP_DB` environment variable):

| Option | Where the data lives |
|---|---|
| `sqlite` (default) | `apps/<app>/.rap/data.db`, one SQLite file per app (WAL mode) |
| `pglite` | `apps/<app>/.rap/pgdata`: embedded **PostgreSQL 18** (WebAssembly), no server needed |
| `postgres://user:pw@host:5432/db` | your PostgreSQL server, one schema per app (`app_<name>`) |

```bash
node bin/rap.js studio apps --db postgres://rap:secret@localhost:5432/rapdb
```

How it maps:

- **`define table`** becomes a real database table with the same column names and the key as primary key. Client fields
  (`abap.clnt`) are dropped (single tenant).
- **CDS view entities** become real database **views** (joins, association paths, `case`, `cast`, functions), so reads
  are plain SQL. Draft-enabled entities get a draft twin view (`<view>$d`) over the **draft table** (`ztravel_d`).
- **Writes** never go straight to the database. OData and EML changes are collected in the RAP **transaction buffer**.
  Determinations run on modify; at save, determinations on save and validations run. Only if nothing failed does the
  save sequence write all `INSERT`/`UPDATE`/`DELETE`s in **one database transaction**; otherwise everything is
  rolled back and the messages go back to the UI. Admin fields (`createdBy`, `lastChangedAt`, …) are filled at save time.
- **Drafts** are saved to the draft tables on every change without validations. **Activate** copies the draft (with its
  children) into the active tables in one transaction and deletes the draft.
- **Late numbering**: new instances and drafts carry a preliminary key until save. Then the saver's `adjust_numbers`
  assigns the final keys, and the runtime rewrites the keys of the children before anything is written.
- **Unmanaged save** (`managed with unmanaged save`): the runtime skips its own `INSERT`/`UPDATE`/`DELETE` and calls the
  saver's `save_modified`, which writes the tables with ABAP SQL. The calls still run inside the same database transaction.
  See `examples/orders` (sales orders with items, both features, with draft).
- **Schema changes** (new fields) migrate in place: new columns are added and existing rows are kept. Views are rebuilt
  on every activation.
- **Seed data** (`data/<table>.json`) is loaded only into empty tables.
- Back up by copying `.rap/` (SQLite, PGlite) or with `pg_dump` (server).

PostgreSQL drivers are asynchronous while the ABAP runtime executes synchronously, like ABAP. The PostgreSQL adapter
runs the driver in a worker thread and waits for each statement with `Atomics.wait`. All SQL goes through a small
dialect layer (`src/db`), and the full test suite passes on both databases (`npm test`, `npm run test:pg`).

## One system: apps share master data

All apps of a studio form one system, like one SAP system. An app can use the tables and CDS views of other apps
(products, customers, suppliers…) by name, in `select from`, joins, associations, value helps and `expose`, without
copying them. At activation the runtime finds the owner app, loads its definitions read-only, and reads its data live:

- SQLite: the owner's `data.db` is attached and read through temporary views.
- PostgreSQL server: a view on the owner's schema (`app_<owner>`).
- Embedded PostgreSQL (`pglite`) keeps every app in its own database, so sharing is not available there (activation says so).

The data stays with the owner, and only the owner's business object changes it. When the owner app changes, the apps
using it are re-activated. `rap catalog <words>` lists what exists. The AI agent searches it before creating master data,
and the new-app prompt lists reusable objects. Small lists (`@ObjectModel.resultSet.sizeCategory: #XS`) become drop-downs.

## SAP standard layer (S/4HANA)

Every system comes with SAP's standard objects, like an S/4HANA client in use: organisational units, configuration,
master data and business documents as tables with SAP's names and keys (`T001`, `T001W`, `TCURR`, `BUT000`, `KNA1`,
`LFA1`, `MARA`, `MARD`, `MBEW`, `SKA1`, `CSKS`; `VBAK`/`VBAP`/`VBEP`/`VBFA`, `LIKP`/`LIPS`, `VBRK`/`VBRP`,
`PRCD_ELEMENTS`, `EBAN`, `EKKO`/`EKPO`/`EKBE`, `RBKP`/`RSEG`, `MATDOC`, `BKPF`/`BSEG`, `ACDOCA`, `AUFK`/`AFKO`/`AFRU`,
`STKO`/`STPO`, `EQUI`, `QMEL`, `QALS`, `ANLA`, `PRPS`, `COEP`, `BPGE`, `CDHDR`, `PA0001` … and EWM/TM tables with their
namespace: `/SCWM/LAGP`, `/SCWM/QUAN`, `/SCWM/ORDIM_C`, `/SCMTMS/D_TORROT` … 341 tables) and the **released CDS views** on top
(`I_CompanyCode`, `I_Customer`, `I_Product`, `I_SalesOrder`, `I_DeliveryDocument`, `I_BillingDocument`,
`I_SDDocumentProcessFlow`, `I_PurchaseOrderAPI01`, `I_MaterialStock_2`, `I_JournalEntryItem`, `I_GLAcctBalanceCube`,
`I_OutboundDelivery`, `I_PurchaseOrder`, `I_ProductionOrder`, `I_ManufacturingOrder`, `I_MaintenanceOrder`, `I_InspectionLot`,
`I_FixedAsset`, `I_Network`, `I_EWMWarehouseTask`, `I_FreightOrder` … 202 views, plus the compatibility views `MKPF`, `MSEG`,
`VBAKUK`, `VBAPUK`, `BSID`/`BSAD`, `BSIK`/`BSAK`, `BSIS`/`BSAS`, `GLPCA`, `COSP`/`COSS`, `ANEK`/`ANEP`/`ANLC`), with seed data: company codes 1010 (DE), 1710 (US) and 4110 (IN) with plants,
storage locations, sales and purchasing organizations, customers, suppliers, products with prices, G/L accounts, cost
and profit centers, currencies and exchange rates; and the year's documents, which follow each other as in a real
system: sales orders → deliveries → goods issues → billing → journal entries → payments, purchase requisitions →
purchase orders → goods receipts → supplier invoices → payments, production orders with confirmations, maintenance
and quality, fixed assets, projects with networks and budgets, CO line items, HR infotypes, EWM warehouse tasks
and TM freight orders for the deliveries. Every journal entry balances, and the stock is what the material documents leave.

Apps use them by name like another app's views: RAP and ABAP Cloud code through the released views (portable to a
real S/4HANA system), classic programs also through the tables. The names follow SAP's
[Cloudification Repository](https://github.com/SAP/abap-atc-cr-cv-s4hc) (the tables are "not to be released", the views
are their released successors). The definitions are RAP Studio's own, with a subset of SAP's fields: check them
against a real system before relying on a field. In the studio, **SAP S/4HANA Standard** (read-only) shows the
objects and their data. Sources: `standard/s4hana`, generated by `python3 standard/generate.py` (organisation and master
data) and `standard/transactional.py` (the documents' tables, views and data, from `standard/dictionaries.json`, which
`standard/extract_dictionaries.py` reads from S/4HANA data dictionary documents).

## Several users and draft locks

Every request runs as a user: the `x-rap-user` header, HTTP Basic auth, or the `rap_user` cookie that the studio's user
button (👤) sets. Without one, the user is `DEVELOPER`. `sy-uname` and the admin fields follow the user.
The same button sets the user's **date format** (SAP's six formats: `DD.MM.YYYY`, `MM/DD/YYYY`, `MM-DD-YYYY`,
`YYYY.MM.DD`, `YYYY/MM/DD`, `YYYY-MM-DD`), which classic screens, ALV grids, `WRITE` lists, `DATE = USER` templates,
printed forms and the function module test page use; it is kept per user in `apps/.rap-user-settings.json`.

- A draft belongs to the user who created it and locks the active instance. Other users see the active data with
  "Locked by …" (`DraftAdministrativeData.InProcessByUser`). They get HTTP 409 when they try to edit, delete or run an
  action on it.
- The lock expires after 15 minutes without changes (`RAP_DRAFT_LOCK_MINUTES`). After that, Edit with
  `PreserveChanges: true` reports the other user's unsaved changes (409). Fiori elements then asks whether to discard
  them, and Edit without PreserveChanges takes the instance over.
- The Fiori elements editing-status filter ("Own draft", "Locked by another user", "Unsaved changes by another user") works.

## Users, roles and access control

Without users, the system runs in development mode: no login, the user is just a name, and everyone has all
authorizations. Once a user exists, every request must log on (login page with a session cookie, or HTTP Basic):

```bash
node bin/rap.js user apps alice --password secret --admin                # administrators use the studio
node bin/rap.js user apps bob --password secret --role Z_SALES_EMEA
node bin/rap.js role apps Z_SALES_EMEA ZSALES ACTVT=03 ZREGION=EMEA       # an authorization (values may end with *)
node bin/rap.js users apps
```

Only administrators (`--admin`) use the studio and an app's development functions (activate, run, debug, code
checks, generators, SQL trace, tests); other users get the apps themselves: their UIs, OData services, value helps and
classic programs. Users live in `apps/.rap-users.json` (passwords hashed with scrypt). Roles hold authorizations like PFCG roles, and are
checked by `AUTHORITY-CHECK` in ABAP and by CDS access controls (`.dcls.asdcls`) in OData reads and ABAP SQL.
`$session.user`, `sy-uname` and `cl_abap_context_info` return the logged-on user.

## RAP features

Managed and unmanaged BOs, draft and collaborative draft with locks, early and late numbering, unmanaged/additional save,
determinations, validations, actions, side effects, feature control, authorization, ETags (`If-Match`, HTTP 412),
business events with event handlers (`rap events <dir>`), change documents (`/api/changes`), behavior extensions,
custom entities (query provider classes), CDS parameters, table functions (AMDP), hierarchies, access controls,
attachments (stream properties) and ABAP Unit (`rap test <dir>`). Details: [docs/LANGUAGE-COVERAGE.md](docs/LANGUAGE-COVERAGE.md).

## Classic ABAP: reports, module pools, function groups

Apps can also hold classic programs: reports (`src/z<name>.prog.abap` + `.prog.xml`, selection screens, `WRITE` lists,
ALV with `cl_salv_table`), module pools with dynpros and transactions, function groups and classic DDIC objects
(data elements, domains, table types). They run on a second engine built from the
[open-abap](https://github.com/open-abap) projects (MIT): [abaplint's transpiler](https://github.com/abaplint/transpiler)
compiles them to JavaScript, `open-abap-core` provides the standard classes, and `open-abap-gui` converts reports and
dynpros into web screens. The engine reads and writes the same SQLite database as the app's RAP business objects,
and reads tables of other apps in the system from their owner's database (read-only).

Every classic object can be created by hand from **+ New** in the studio, with a form or visual editor where SAP has
one: domains and data elements (SE11), tables with a field grid, check tables and references, structures and table
types, lock objects, message classes, function groups and function modules with a parameter editor (SE37), reports
with text elements (SE38), module pools with a screen painter, field picker from the dictionary, table-control and
tabstrip wizards and a GUI status editor (SE51 / SE41), transactions (SE93), Adobe forms with their form interface
(SFP), and classes and exception classes (SE24).

Instead of the SAP GUI window chrome, programs get the RAP Studio look: a launcher with one tile per program, a header
with the program's actions, card-style selection screens and lists, light and dark mode.

```bash
npm run setup:open-abap                 # once: clone the open-abap repositories into vendor/ and build the converter
node bin/rap.js gui <dir> [--port 4005] # compile the app's classic programs and serve them
node bin/rap.js gui <dir> --build-only  # compile only, print errors
```

From an app folder, the programs also run on the command line, which is how the AI agent tests what it builds and
answers "run …" requests in the chat (they use the studio's engine for the app, or start one):

```bash
node bin/rap.js programs                                    # programs and transaction codes
node bin/rap.js program ZCFLIGHT_REPORT P_CARR=AA           # run a report, print the list
node bin/rap.js transaction ZCFL GV_CARRIER=LH GV_CONNECTION=0400 --step SHOW --step SAVE GV_PRICE=610
node bin/rap.js job schedule ZCFLIGHT_REPORT P_CARR=LH [--at 2026-11-05T06:00:00Z] [--every 1440]
node bin/rap.js jobs | job <nr> | job cancel <nr> | job delete <nr>
node bin/rap.js logs | log <handle>
node bin/rap.js form ZCFL_FLIGHT_LIST [--data '{…}'] [--print] [--out list.pdf]
node bin/rap.js outputs | output delete <nr>
node bin/rap.js table zcflight_a carrier_id=LH
```

`examples/classic` is the reference set of classic objects the agent copies from.

What runs, each covered by `test/classic.test.mjs`:

| | |
|---|---|
| Reports | selection screens (parameters, select-options, checkboxes), `WRITE` lists, ALV |
| Value help (F4) | every screen field with a check table, domain fixed values or a domain value table gets a value-help button; F4 or the button opens a searchable list of the values with their texts (parameters, select-options, dynpro fields) |
| Module pools | dynpros with PBO/PAI, GUI status functions, transactions (`.tran.xml`); each dialog step commits |
| Lock objects | `ENQUEUE_`/`DEQUEUE_` function modules, locks per user session, `FOREIGN_LOCK` with the owner |
| Function groups | function modules with exceptions; the group metadata is generated from the interface comment; **Functions** page tests a function module like SE37 (typed parameters, fixed values, exports, exceptions), also `rap fm Z_FUNCTION IV_X=value` |
| DDIC | data elements, domains with fixed values (RTTS), table types |
| Application logs | `cl_bali_log` saved to the app's database; **Logs** page |
| Background jobs | `JOB_OPEN`/`JOB_SUBMIT`/`JOB_CLOSE`, periodic jobs, "Run in background" on selection screens; spool on the **Jobs** page |
| Print forms | SAP Adobe forms: layouts in `src/<form>.form.json`, edited in a visual designer (object library, drag and drop, data binding, properties) or as JSON: master pages, tables with repeated headers, groups and totals, calculations (FormCalc-like expressions, row by row), conditions, text modules, images, embedded TrueType fonts (any script), 2D and linear barcodes (QR, Data Matrix, PDF417, Aztec, Code 128 / 39 / 93, GS1-128, EAN / UPC, ITF, Codabar), fillable fields with calculations, digital signatures, PDF/A-2b, AES-256 passwords and permissions; Adobe LiveCycle Designer XDP import with JavaScript / FormCalc scripts and dynamic (flowed) layouts converted. ABAP: the ABAP Cloud APIs (`cl_fp_form_reader`, `cl_fp_fdp_services` data providers, `cl_fp_ads_util=>render_pdf`, print queue), the classic `FP_JOB_OPEN` / generated function module / `FP_JOB_CLOSE`, `cl_fp` PDF objects (extract data, sign, verify), `zcl_rap_form`; **Output** and **Forms** pages |
| XCO | `xco_cp=>…` (open-abap-xco) |
| Tables | **Tables** page: the app's tables with filters (like SE16) |

To try all of it, open the **Classic ABAP Showcase** app (`apps/classic-showcase`) in the studio and pick
**Classic ABAP programs** in the preview: run the reports, transaction ZCFL (open it in two browser tabs to see the
lock), the price check (log and background job) and the print report, then look at the Jobs, Logs, Output (PDF
viewer), Forms and Tables pages.

In the code editor every object has **Check** (Ctrl+F2: the code checks of that object, on the unsaved text),
**Activate** (Ctrl+F3) and **Save** (Ctrl+S), and runnable objects a **Run** button (F8): tables and CDS views open
the data preview, function modules their test page, reports and transactions start on the classic engine, console
classes run. Print form layouts open in a visual designer (Design) and next to a live PDF preview (Preview) that follows the editor, with the layout's sample data or
a record of its data provider and a choice of locale. abapGit XML objects (data elements, domains, table types, transactions,
lock objects, program attributes with screens and GUI status) open as a readable form, with a Source tab to edit.

In the studio, the preview menu shows **Classic ABAP programs** for apps that have them; the engine is built and
started on demand (one process per app) and rebuilt when a program changes. RAP Studio's own additions to the
open-abap libraries are in `src/classic/abap` (job function modules, log tables, `zcl_rap_form`), and two small fixes
to open-abap are applied as patches by the setup (`scripts/open-abap-patches/`). Code: `src/classic/`.

## OData V2

Every service is also served as OData V2, at the SAP Gateway URL `/sap/opu/odata/sap/<SERVICE>/` below the app
(for example `/a/travel/sap/opu/odata/sap/ZUI_TRAVEL/`): `$metadata` (EDMX 1.0 with `sap:` annotations), JSON in the
V2 format, `$inlinecount`, `$expand`, V2 filter functions and literals, `MERGE`, `$batch` with change sets, and
function imports for the actions and the draft actions (`TravelEdit`, `TravelActivate`, …). Requests are translated
to the V4 service, so the RAP behavior is the same. Tested in `test/odata-v2.test.mjs` and with the SAPUI5
`sap.ui.model.odata.v2.ODataModel`. In the studio, the preview menu of every app with a service has **OData V2
services (SAPUI5 test)**: a SAPUI5 page on the V2 model that lists the entity sets, opens records, calls the function
imports (actions, draft) and links the `$metadata`.

## Developer tools: debugger, runtime errors, SQL trace

- **Debugger**: click the margin next to a line number in the code editor to set a breakpoint, then **Debug**
  (Shift+F8) on a console class, or **Debug** / **Debug tests** in the Console tab. The run stops at the breakpoints
  (without any, at the first statement) and shows the line, the variables (tables, structures and objects can be
  expanded), the attributes of `me`, the call stack and the system fields. **Step into** (F5), **Step over** (F6),
  **Return** (F7), **Continue** (F8), **Stop**, as in the SAP debugger. Breakpoints can change while it runs. The run
  happens in a worker thread with a debug build of the app, on the app's database: a stopped run does not commit.
- **Runtime errors** (like ST22): an exception that no ABAP code catches (console runs, OData requests, application
  jobs, background processes) is recorded with its class, text, the ABAP call stack (class, method, file and line of
  every frame) and the source around the failing statement; listed in the Problems tab, a click opens the line.
- **SQL trace** (like ST05): the switch in the Console tab records every ABAP SQL statement with its time, rows,
  parameters and the ABAP method that ran it (also inside the debugger).

## Code quality: checks, ABAP cleaner, conformance

> **`rap check` and `rap test` are a local runner and test bed, not a promise that code activates on SAP.**
> They compile and run your code here and catch real bugs fast, but they do not know your SAP system. `rap check`
> therefore also warns about code that runs here but would not on SAP BTP or S/4HANA: unknown types of the customer
> namespace, objects not released for ABAP Cloud (`SELECT FROM mara`) and `COMMIT WORK` / `ROLLBACK WORK` in behavior
> implementations. Run `rap atc` for the full ABAP Cloud checks, and activate on a real system before you rely on it.

- **Code checks** (like ATC): `node bin/rap.js atc <dir> [--fix]` and the studio's **Problems** tab run a check
  variant written in markdown (`knowledge/checks/variants/default.md`: categories Syntax and correctness, ABAP Cloud
  readiness, Security, Performance, Robustness, Clean ABAP, each check with a severity). The checks are
  [abaplint](https://abaplint.org) rules plus RAP Studio's `released_api` check, which uses SAP's Cloudification
  Repository to report non-released objects in ABAP Cloud code with their released successor (`KNA1` → `I_Customer`).
  Findings explain themselves (abaplint's documentation and the [abapOpenChecks](https://github.com/larshp/abapOpenChecks)
  descriptions in `knowledge/abapopenchecks`), and many have automatic fixes. An app can adjust rows in its `checks.md`.
- **ABAP cleaner**: `npm run setup:abap-cleaner` fetches SAP's [ABAP cleaner](https://github.com/SAP/abap-cleaner)
  (stand-alone build with its own Java). `node bin/rap.js clean <dir> [file]` and **Clean up** in the code editor apply
  its cleanup rules; when the cleaned code would not activate, the change is undone.
- **Conformance with real-world ABAP**: `npm run conformance:exercism` compiles and unit-tests the reference solutions
  of [exercism's ABAP track](https://github.com/exercism/abap): all 55 exercises (602 tests).
  `npm run conformance:cheatsheets` runs SAP's [ABAP cheat sheets](https://github.com/SAP-samples/abap-cheat-sheets)
  (every class with `if_oo_adt_classrun`, to the end): all 28 run, all 65 classes compile.
- `knowledge/` holds the markdown the platform and the agent read (see `knowledge/README.md`).

## Practice ABAP (exercises)

**Practice ABAP** in the studio header opens the practice exercises of
[exercism's ABAP track](https://github.com/exercism/abap) (MIT): 54 exercises by level (Easy, Medium, Hard), from
internal tables and strings to ciphers and the knapsack problem. Each one has the task, a class to complete and its
ABAP Unit tests. Write the class in the editor (saved as you type), press **Run tests** (F8) and see each test pass or
fail with expected and actual values; syntax errors are listed with their line. **Check** runs the code checks,
**Clean up** SAP's ABAP cleaner. The reference solution unlocks once the tests pass (or on request), and the list keeps
your progress. The track is downloaded on first use (`vendor/exercism-abap`); your work is in `apps/.exercises/`.
Tests run in a separate process with a time limit, so an endless loop only stops that run.

## Moving an app to an SAP system

`node bin/rap.js abapgit <dir> <out-dir>` (or the studio's **abapGit** button) writes the app as an abapGit repository:
the sources plus object XML, CDS tables converted to DDIC table XML, and an OData V4 UI service binding per service.
Push it to a Git repository and pull it into a package with abapGit in ADT. The XML is generated: check the first import.

## How it works

```
 sources (abapGit layout)
   ├─ CDS  ──────────────► src/ddl/cds.js  ─┐
   ├─ BDEF ──────────────► src/ddl/bdef.js ─┤
   └─ ABAP classes ──┬───► abaplint (syntax check against the SAP grammar, ABAP Cloud)
                     └───► src/abap/compiler.js ──► JavaScript classes (+ src/abap/runtime.js)
                                     │
                    activation: src/rap/model.js → tables, views, draft tables, handlers bound
                                     │
 HTTP: src/studio (workbench, agent) ─► src/server/odata.js (OData V4) ─► src/rap/rap.js (RAP runtime) ─► src/db (SQLite | PostgreSQL)
```

- **ABAP → JavaScript.** Each ABAP class becomes a JavaScript class. The ABAP control flow maps 1:1, and value
  semantics (copying structures/tables, field symbols, ABAP comparison and conversion rules) live in `$rt`.
  EML statements call the RAP runtime; ABAP SQL is translated to SQL.
- **Syntax checking** uses [abaplint](https://github.com/abaplint/abaplint). Parser errors block activation and semantic findings show
  as warnings. Released SAP APIs are provided as ABAP stubs in `src/check/stdlib`.
- **Conformance** is measured against SAP's [ABAP cheat sheets](https://github.com/SAP-samples/abap-cheat-sheets)
  (`node test/conformance.mjs <dir>/src`). All of its CDS sources and BDEFs parse, and 60 of its 65 sources compile.
  See [docs/LANGUAGE-COVERAGE.md](docs/LANGUAGE-COVERAGE.md).

## Commands

```bash
node bin/rap.js [studio] [apps] [--db ...] [--host 127.0.0.1] [--port 4004]   # the studio for all apps
node bin/rap.js setup [--cleaner]                   # install the classic engine (and SAP's ABAP cleaner)
node bin/rap.js serve <dir> [--db ...]              # serve one app (built-in Fiori-like UI at /)
node bin/rap.js check <dir>                         # activate + abaplint, exit code 1 on errors
node bin/rap.js run <dir> <class>                   # run an if_oo_adt_classrun class
node bin/rap.js fiori <dir> --template lrop|worklist|alp|ovp|fpm|freestyle --service <srvd> --entity <Set> [--name app]
node bin/rap.js catalog [words]                     # tables and views of the other apps in the system (run in an app folder)
node bin/rap.js odata GET|POST|PATCH|DELETE <path> [json] [--user NAME]   # call the app's OData service on the studio
node bin/rap.js test <dir> [filter]                 # ABAP Unit tests (classes FOR TESTING)
node bin/rap.js events <dir>                        # business events raised by the app
node bin/rap.js user|role|users <apps-dir> ...      # users and roles (see above)
node bin/rap.js abapgit <dir> <out-dir>             # export as an abapGit repository
node bin/rap.js atc <dir> [--fix]                   # code checks (check variant in knowledge/checks/variants)
node bin/rap.js clean <dir> [file]                  # SAP's ABAP cleaner (npm run setup:abap-cleaner first)
node bin/rap.js gui <dir> [--port 4005|--build-only] # classic reports and module pools (npm run setup:open-abap first)
node bin/rap.js js <dir> <class>                    # show the generated JavaScript
npm test                                            # end-to-end tests on SQLite
npm run test:pg                                     # the same tests on PostgreSQL (embedded)
```

## Not supported yet

- A few uncommon ABAP statements (see [docs/LANGUAGE-COVERAGE.md](docs/LANGUAGE-COVERAGE.md)) and XSLT 2.0.
- Importing the abapGit export into a real SAP system has not been tried yet.

## Credits

RAP Studio stands on the work of these open source projects. Thank you to their authors and contributors.

| Project | Used for | License |
|---|---|---|
| [abaplint](https://github.com/abaplint/abaplint) (`@abaplint/core`) | ABAP parser, syntax checks and most code-check rules | MIT |
| [abaplint transpiler](https://github.com/abaplint/transpiler) (`@abaplint/transpiler-cli`, `@abaplint/runtime`) | compiles classic ABAP to JavaScript for the classic engine | MIT |
| [open-abap](https://github.com/open-abap): open-abap-core, open-abap-gui, express-icf-shim, open-abap-bal, open-abap-pdf, open-abap-lock, open-abap-jobs, open-abap-xco | the classic engine's standard classes, report and dynpro screens, HTTP, logs, PDF, locks, jobs and XCO; downloaded by `npm run setup:open-abap` | MIT (see each repository) |
| [ABAP cleaner](https://github.com/SAP/abap-cleaner) (SAP) | clean-up rules; downloaded by `npm run setup:abap-cleaner` | Apache 2.0 |
| [abapOpenChecks](https://github.com/larshp/abapOpenChecks) | check descriptions in `knowledge/abapopenchecks` | MIT |
| [Cloudification Repository](https://github.com/SAP/abap-atc-cr-cv-s4hc) (SAP) | released objects and successors for the `released_api` check | Apache 2.0 |
| [ABAP cheat sheets](https://github.com/SAP-samples/abap-cheat-sheets) (SAP samples) | conformance tests of the runtime | Apache 2.0 |
| [exercism ABAP track](https://github.com/exercism/abap) | Practice ABAP exercises and conformance tests | MIT |
| [Forms service by Adobe samples](https://github.com/SAP-samples/forms-service-by-adobe-samples), [ABAP partner reference application](https://github.com/SAP-samples/abap-partner-reference-application) (SAP samples) | the Adobe forms reference app and XDP test layouts | Apache 2.0 |
| [PGlite](https://github.com/electric-sql/pglite), [node-postgres](https://github.com/brianc/node-postgres), [Express](https://github.com/expressjs/express) | embedded PostgreSQL, PostgreSQL driver, the classic engine's HTTP server | Apache 2.0, MIT, MIT |
| [bwip-js](https://github.com/metafloor/bwip-js), [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator), [Arimo](https://fonts.google.com/specimen/Arimo) | barcodes, QR codes and the default font of print forms | MIT, MIT, OFL 1.1 |
| [Monaco Editor](https://github.com/microsoft/monaco-editor), [PDF.js](https://github.com/mozilla/pdf.js) | the code editor and the PDF viewer (loaded from jsDelivr) | MIT, Apache 2.0 |
| [SAPUI5](https://ui5.sap.com) (SAP) | Fiori elements and SAPUI5 apps, loaded from SAP's CDN | SAP's terms of use |

SAP, ABAP, Fiori, SAPUI5 and other SAP product names are trademarks of SAP SE. RAP Studio is an independent project,
not affiliated with or endorsed by SAP.

## License

RAP Studio is open source under the [Apache License 2.0](LICENSE). Material from other projects keeps its own
license; see [NOTICE](NOTICE).
