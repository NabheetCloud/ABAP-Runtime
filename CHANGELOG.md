# Changelog

## 1.0.0 (2026-11)

The first public release: build, run and debug SAP ABAP applications, RAP and classic, on your own machine. No SAP
server and no cloud account. Open source under the Apache License 2.0.

### What you can do with RAP Studio 1.0.0

**RAP (ABAP RESTful Application Programming Model)**
- Write CDS (tables, view entities, projections, metadata extensions, parameters, associations, compositions, table
  functions, hierarchies, access controls, custom entities), behavior definitions and behavior pools in standard
  syntax, in abapGit layout.
- Managed and unmanaged business objects; draft and collaborative draft with locks; early and late numbering;
  unmanaged / additional save; determinations, validations, actions, side effects, feature control, authorization
  checks, ETags; business events and event handlers; change documents; behavior extensions; attachments; EML.
- ABAP Unit tests (`rap test`), console classes (`if_oo_adt_classrun`), released ABAP Cloud APIs.

**OData, SAP Fiori and SAPUI5**
- Every service as OData V4 (`$batch`, `$apply`, `$filter`, `$search`, `$expand`, `$count`, the draft protocol) and as
  OData V2 at the SAP Gateway URL, with annotations generated from CDS and the behavior definition.
- Generate and run SAP Fiori elements apps (List Report / Object Page, Worklist, Analytical List Page, Overview Page,
  Flexible Programming Model) and freestyle SAPUI5 apps against your services.

**Classic ABAP, built by hand like in SE11 / SE37 / SE38 / SE51 / SE24 / SFP**
- Dictionary: domains (fixed values, value tables, CURR / QUAN), data elements with or without a domain, structures,
  table types, database tables (field grid, check tables, references, technical settings), lock objects, message
  classes, exception classes.
- Programs: reports with selection screens and text elements, `WRITE` lists and ALV; function groups and function
  modules with a parameter editor and an SE37-style test page; module pools with a screen painter, dictionary field
  picker, table-control and tabstrip wizards, GUI status and transactions; classes used from all of them.
- F4 value help on every screen field (check table, fixed values, value table); the user's date format; locks with
  `ENQUEUE_` / `DEQUEUE_`; background jobs; application logs.

**Print forms (SAP Adobe forms)**
- Form interfaces, a visual layout designer, Adobe LiveCycle XDP import with scripts, live PDF preview; barcodes,
  fonts, fillable fields, signatures, PDF/A, encryption.
- Print programs with `FP_JOB_OPEN` / the form function module / `FP_JOB_CLOSE`, and the ABAP Cloud form APIs; an output
  queue.

**Developer tools**
- Debugger for classes, behavior handlers, reports, FORMs, function modules and PAI modules: breakpoints, step into /
  over / return, watches, variables, call stack, system fields.
- Runtime errors like ST22, SQL trace like ST05, code checks like ATC (abaplint rules plus a released-API check with
  successors), SAP's ABAP cleaner, data preview like SE16, code completion, go to definition, where-used, rename.

**A whole system on your laptop**
- SQLite or PostgreSQL (embedded or your server); apps share master data like one SAP system; an S/4HANA standard
  layer with 341 tables and 202 released views with consistent demo documents.
- Users, roles and authorizations (`AUTHORITY-CHECK`, CDS access controls); only administrators build and change apps.
- abapGit export to move an app to an SAP system.

**Build by chat (optional)**
- Describe an app or a change and the build agent writes the sources, checks and activates them, with attachments
  (specifications, screenshots). For now it works with a local Claude Code CLI on your machine; everything else works
  without it.

**Learn**
- Practice ABAP: 54 exercises with ABAP Unit tests, code checks and clean-up.
- Six demo apps: Travel Management (RAP with draft and Fiori elements), Purchase Orders (classic, built by hand),
  Classic ABAP Showcase, Adobe Print Form, Library, Sales Orders.

### New since 0.0.5

- F4 value help on classic screens: a searchable pop-up with the values of the check table, the domain's fixed values
  or its value table, on parameters, select-options and screen fields.
- The user's date format (SAP's six formats) on screens, ALV grids, `WRITE` lists, `DATE = USER` templates, printed
  forms and the function module test page; impossible dates are refused.
- OData V4: `$filter` applies to the result of `$apply`.
- Code checks know function groups (no false `SELECT *` findings).
- Security: the studio and `rap serve` listen on this machine only (`--host` to expose them), refuse other host names and
  changes requested by other web sites; the build agent's command list is enforced; with users, development functions
  are for administrators, classic programs run as the logged-on user, and users who are no administrators get a page
  with their apps.
- Studio: hide the chat (Ctrl+\\), local times on jobs / logs / output, an activation number that counts real changes.
- Install: `rap` starts the studio, `rap setup` installs the classic engine at tested versions, `npx rap-studio`.
- CI on Linux and macOS; CHANGELOG, SECURITY and CONTRIBUTING; curated demo apps with seed data.

## 0.0.5 (2026-11-10)

Build every classic object by hand and run and debug it locally: domains, data elements with and without a domain,
structures, table types, tables with check tables, lock objects, message classes, exception classes, function groups
and function modules (parameter editor, SE37-style test), reports with text elements, module pools (screen painter
with dictionary field picker, table-control and tabstrip wizards, GUI status, transactions), Adobe forms with form
interfaces, classes used from all of them. The debugger stops in FORMs, WHEN branches, function modules, methods and
PAI modules. Three hand-acceptance rounds.

## 0.0.4 (2026-11-06)

Build everything by hand: New Object dialog (26 kinds), RAP business object from a table, code intelligence
(completion, go to definition, where-used, rename, hover, outline), visual editors for tables, CDS views, behavior
definitions, Fiori annotations and module pool screens; deliverables.

## 0.0.3 (2026-11-05)

Debugger for classic reports, module pools and function modules.

## 0.0.2 (2026-11-05)

Deliverables (technical specification, QA report, code-check report) with every development of the AI agent; archive,
restore and delete apps; downloads from classic reports; S/4HANA standard layer with business documents; Adobe-forms
style print forms (layout engine, Cloud and classic APIs, XDP import, barcodes, PDF/A, signatures); debugger, runtime
errors and SQL trace; function modules, SAP LUW, SUBMIT and CALL TRANSACTION on one runtime; Practice ABAP.

## 0.0.1 (2026-11-04)

A local ABAP RAP runtime (CDS, BDEF, ABAP behavior classes on Node.js, SQLite or PostgreSQL, OData V4, SAP Fiori
elements and SAPUI5) and the chat studio; the classic ABAP engine for reports, module pools and function groups.
