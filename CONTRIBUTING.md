# Contributing to RAP Studio

Thank you for helping. Bug reports with a small app that shows the problem help most.

## Set up

```bash
git clone https://github.com/NabheetCloud/ABAP-Runtime.git
cd ABAP-Runtime
npm install
npm run setup          # the classic ABAP engine (open-abap, tested commits)
npm test               # end-to-end tests on SQLite
npm run test:pg        # the same on embedded PostgreSQL
npm run studio         # http://localhost:4004
```

Node.js 22.5 or later. `npm run setup:abap-cleaner` adds SAP's ABAP cleaner (needs Java, downloaded once).

## Changes

- One topic per pull request, with a test in `test/` that fails without the change.
- `npm test` must pass. Code checks of the demo apps (`node bin/rap.js atc apps/<app>`) must show 0 errors.
- Keep ABAP semantics as SAP has them; where RAP Studio deviates, say so in the README's "Not supported yet" list.
- Sources written for SAP systems stay valid: RAP Studio reads abapGit layout and never needs special syntax.
- The UI never names third-party products as its own.

## Where things are

| Folder | What |
|---|---|
| `src/abap`, `src/ddl`, `src/rap` | ABAP compiler and runtime, CDS / BDEF parsers, the RAP runtime |
| `src/server` | OData V4 / V2, users and authorizations, the workspace server |
| `src/classic` | the classic engine host (reports, module pools, function modules, forms) |
| `src/studio`, `src/ui/studio` | the studio server and its web UI |
| `src/check` | activation and code checks (abaplint, check variants in `knowledge/checks`) |
| `knowledge/` | markdown the platform and the build agent read |
| `examples/`, `apps/` | reference apps and the demo apps |

By contributing you agree that your contribution is licensed under the Apache License 2.0.
