# Changelog

## 1.0.0 (2026-11)

The first public release, open source under the Apache License 2.0.

**Classic ABAP**
- F4 value help on every screen field, parameter and select-option whose dictionary type has values: the check table
  of the table field, the fixed values of the domain, or the domain's value table. A searchable pop-up with the
  values and their texts (keyboard: arrows, Enter, Esc).
- The user's date format (SAP's six formats, chosen in the studio's user dialog) on screens, ALV grids, `WRITE`
  lists, `DATE = USER` templates, printed forms and the function module test page.
- Jobs, logs and the output queue show times in local time; scheduled start times are local.

**OData**
- `$filter` applies to the result of `$apply`, as OData V4 defines; conditions on properties the result no longer
  has (`IsActiveEntity` after `groupby`) still restrict the rows first.

**Code checks**
- Function groups are known to the checks: no false `SELECT *` findings, and findings that need the function
  module's interface (EXPORTING parameters read before they are set) now appear.

**Security**
- The studio and `rap serve` listen on 127.0.0.1 by default (`--host` to expose them, with a warning while no users
  exist), answer only for loopback host names and refuse changes requested by other web sites.
- With users, an app's development functions (activate, run, debug, code checks, generators, SQL trace, tests) are
  for administrators; other users get the apps: their UIs, OData services, value helps and classic programs.
- The build agent runs with its tool list enforced. Value helps of the built-in UI read only declared value-help
  entities, as the user of the request. The users file is readable by its owner only.

**Studio**
- The chat can be hidden for more room (button in the tab bar, Ctrl+\\); "Active · vN" counts activations of changed
  sources only; steadier text-elements editor.
- `rap` with no command starts the studio; `rap setup` installs the classic engine; `rap --version`.
- The classic engine is installed at tested commits of the open-abap projects, and Practice ABAP at a tested commit
  of exercism's ABAP track, so a fresh install works the same as the tested one.
- A curated set of demo apps (Travel, Classic ABAP Showcase, Adobe print form, Library, Sales orders, Purchase
  orders).

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
