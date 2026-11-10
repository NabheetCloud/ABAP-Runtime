# Knowledge

Markdown that steers RAP Studio and its AI agent, next to the JavaScript platform. The platform reads these files
at runtime (no build step), and the agent reads them when it works on an app, so changing a file here changes how
apps are checked and built.

| Folder | What | Used by |
|---|---|---|
| `objects.md` | Every object kind the runtime supports: file, sample to copy, pitfalls, released APIs in detail | the agent |
| `classic.md` | Classic programs: reports, module pools (dynpro elements, flow logic, GUI status), available function modules, DDIC XML | the agent |
| `forms.md` | Print forms (SAP Adobe forms): layout, expressions, ABAP APIs, XDP import, PDF/A, encryption, workflow | the agent |
| `checks/variants/` | Check variants: categories, checks, severity, settings (`default.md`). An app can change rows in its own `checks.md`. | `rap atc`, the studio's Problems tab, the agent |
| `checks/rules/` | Explanations of RAP Studio's own checks (`released_api.md`) | "?" on a finding, the agent |
| `abapopenchecks/` | The check descriptions of [abapOpenChecks](https://github.com/larshp/abapOpenChecks) (MIT, see `LICENSE`); abaplint implements many of them | explanations of findings |
| `abap-cleaner/rules/` | The cleanup rules of SAP's [ABAP cleaner](https://github.com/SAP/abap-cleaner) (Apache-2.0, see `LICENSE`); a `profile.cfj` here replaces its default profile | `rap clean`, "Clean up" in the editor |
| `sap/released-objects.json` | Released ABAP Cloud objects and the successors of non-released ones, from SAP's [Cloudification Repository](https://github.com/SAP/abap-atc-cr-cv-s4hc) (Apache-2.0) | the `released_api` check |

Related sources outside this folder: `standard/s4hana` (SAP standard tables and released views with data),
`examples/` (reference apps the agent copies), `src/studio/template/CLAUDE.md` (the agent's instructions per app).

## Check variants

```md
## Performance

| Check | Severity | Settings |
|---|---|---|
| db_operation_in_loop | warning | |
| method_length | info | {"statements": 100} |
```

Headings are categories, rows are checks: an [abaplint rule](https://rules.abaplint.org) or a RAP Studio check
(`released_api`), a severity (`error`, `warning`, `info`, `off`) and optional JSON settings for the rule.
