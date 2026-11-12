#!/usr/bin/env node
// rap: command line for the open RAP runtime
//   rap serve <dir> [--port 4004]   activate a workspace and serve OData + Fiori-like UI (live reload)
//   rap check <dir>                 activate and report syntax/activation errors (exit code 1 on errors)
//   rap run <dir> <class> [--trace] run a class implementing if_oo_adt_classrun (--trace: its SQL statements)
//   rap dumps <dir> | dump <dir> <nr>   runtime errors (like ST22): exception, ABAP call stack, source
//   rap debug <dir> <class> --break src/x.clas.abap:12 [--break …] [--max 20]
//                                   run a console class in the debugger: at every stop the variables and the stack
//   rap system <dir> [table] [--top 20]   the runtime's records: application jobs, logs, background processes,
//                                   mail outbox, number ranges, output queue
//   rap js <dir> <class>            print the JavaScript generated for a class
//   rap test <dir> [filter]         run ABAP Unit tests (classes FOR TESTING, e.g. in .clas.testclasses.abap)
//   rap studio [apps-dir]           chat-driven studio hosting many apps (uses the local AI agent CLI)
//   rap catalog [search words]      tables and CDS views of the other apps in this system (to reuse, not copy)
//   rap odata <GET|POST|PATCH|DELETE> <path> [json] [--user NAME]
//                                   call this app's OData service on the running studio (run inside the app folder)
//   rap user <dir> <name> [--password pw] [--role R,...] [--name "Full Name"] [--admin] [--delete]
//                                   create/change a user of the system (<dir>: apps folder or app); no users = no login
//   rap role <dir> <ROLE> <AUTH_OBJECT> FIELD=v1,v2 ...  add an authorization to a role (values may end with *)
//   rap users <dir>                 list users and roles
//   rap events <dir> [--top 20]     business events raised by the app (event log)
//   rap abapgit <dir> <out-dir> [--package ZPKG]   export the app as an abapGit repository (for a real SAP system)
//   rap gui <dir> [--port 4005]     build and serve the app's classic programs (reports, module pools, function groups)
//   rap gui <dir> --build-only      only compile them and print the errors
//   rap programs | program <PROG> [P=v ...] | transaction <TCODE> [F=v ...] [--step FCODE [F=v ...]] ...
//   rap jobs | job <nr> | job schedule <PROG> [P=v ...] [--at ISO] [--every MIN] | logs | log <h>
//   rap table [<name> [F=v ...]]
//   rap forms | form <FORM> [KEY=v ...] [--data json] [--locale L] [--out f.pdf] [--print] [--sign KEY]
//   rap form check [FORM] | form import <file.xdp> | form key <NAME> | form fields|verify <file.pdf>
//   rap outputs | output <nr> [--out f.pdf] | output delete <nr>
//                                   print forms of this app (run inside the app folder; see src/forms/cli.mjs)
//   rap functions | fm <FUNCTION> [PARAM=value ...]   test a function module (like SE37)
//                                   classic programs of this app (run inside the app folder; see src/classic/cli.mjs)
//   rap appjobs <dir> [--run]       application jobs (cl_apj_rt_api) of the app; --run runs the due ones
//   rap atc <dir> [--variant default] [--fix [rule]] [--json]   code checks (check variants: knowledge/checks/variants)
//   rap deliver <dir> [--no-fix]   the delivery documents: technical specification, QA test report with screenshots,
//                                   ATC check report (quick fixes applied first) in <dir>/docs/<date>-<topic>/
//   rap clean <dir> [file]          ABAP cleaner on the app's ABAP sources (npm run setup:abap-cleaner first)
//   --db sqlite | pglite | postgres://user:pw@host:5432/db   database (default sqlite; env RAP_DB)
//   rap fiori <dir> --template lrop|worklist|alp|fpm|ovp|freestyle --service <srvd> --entity <EntitySet> [--name app]
//                                   generate an SAP Fiori elements app into <dir>/webapp/<name>
import fs from 'node:fs';
import path from 'node:path';
import { Workspace, startServer } from '../src/server/server.js';
import { Studio } from '../src/studio/studio.js';
import { generateFioriApp, TEMPLATES } from '../src/studio/fiori.js';

// positional arguments: flags and the values of --port / --host / --db / --model / … are not positional
const VALUE_FLAGS = new Set(['--port', '--host', '--db', '--model', '--template', '--service', '--entity', '--name', '--password', '--role', '--top', '--data', '--out', '--at', '--every', '--variant', '--user']);
const ARGS = process.argv.slice(2).filter((a, i, all) => !a.startsWith('--') && !VALUE_FLAGS.has(all[i - 1]));
const [cmd, dir = '.', arg] = process.argv[2]?.startsWith('--') ? [undefined, ...ARGS] : process.argv.slice(2).map(a => (a.startsWith('--') ? undefined : a));
const flag = (name, def) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : def; };
const print = d => {
  for (const e of d.errors) console.log(`  ERROR   ${e.file}${e.line ? ':' + e.line : ''}  ${e.message}`);
  for (const w of d.warnings) console.log(`  warning ${w.file}${w.line ? ':' + w.line : ''}  ${w.message}`);
};

if (cmd === 'help' || process.argv.includes('--help') || cmd === '--version' || process.argv[2] === '--version') {
  if (process.argv.includes('--version')) { console.log(JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version); process.exit(0); }
  console.log(`RAP Studio: build, run and debug ABAP RAP and classic ABAP apps locally
usage:
  rap [studio] [apps-dir] [--port 4004] [--host 127.0.0.1]   the studio (default: ./apps)
  rap setup [--cleaner]                                       install the classic ABAP engine (and SAP's ABAP cleaner)
  rap serve|check|run|test|atc|js <app-dir> …                 one app (see the README for every command)`);
  process.exit(0);
}
// rap setup: the classic engine (open-abap, pinned commits) and optionally SAP's ABAP cleaner, also for npx installs
if (cmd === 'setup') {
  const { execFileSync } = await import('node:child_process');
  const script = n => execFileSync(process.execPath, [new URL(`../scripts/${n}`, import.meta.url).pathname], { stdio: 'inherit' });
  script('setup-open-abap.mjs');
  if (process.argv.includes('--cleaner')) script('setup-abap-cleaner.mjs');
  process.exit(0);
}
if (['forms', 'form', 'outputs', 'output'].includes(process.argv[2])) {
  const { formsCli } = await import('../src/forms/cli.mjs');
  await formsCli(process.argv[2]);
  process.exit(0);
}
if (['programs', 'program', 'transaction', 'jobs', 'job', 'logs', 'log', 'table', 'functions', 'fm'].includes(process.argv[2])) {
  const { classicCli } = await import('../src/classic/cli.mjs');
  await classicCli(process.argv[2]);
}
if (cmd === 'clean') {
  const ws = new Workspace(dir, { lint: false, dbFile: ':memory:' });
  try {
    const r = ws.cleanUp(arg);
    if (!r.ok) {
      console.log(`[rap] ABAP cleaner changed ${r.undone.join(', ')}, but the result does not activate, so the changes were undone:`);
      for (const e of r.errors) console.log(`  ERROR   ${e.file}${e.line ? ':' + e.line : ''}  ${e.message}`);
      process.exit(1);
    }
    console.log(`[rap] ABAP cleaner: ${r.stats}`);
    console.log(r.files.length ? `[rap] cleaned ${r.files.length} file(s): ${r.files.join(', ')}` : '[rap] nothing to clean');
  } catch (e) { console.log(`[rap] ${e.message}`); process.exit(1); } finally { ws.close(); }
  process.exit(0);
}
if (cmd === 'atc') {
  const { runAtc, fixAtc } = await import('../src/check/atc.js');
  const ws = new Workspace(dir, { lint: false, dbFile: ':memory:' });
  const known = ws.knownObjects();
  ws.close();
  const variant = flag('--variant', 'default');
  if (process.argv.includes('--fix')) {
    const rule = flag('--fix');
    const f = fixAtc(dir, { variant, rule: rule && !rule.startsWith('--') ? rule : undefined, knownObjects: known });
    console.log(`[rap] ${f.fixed} quick fix(es) applied${f.files.length ? ` in ${f.files.join(', ')}` : ''}`);
  }
  const r = runAtc(dir, { variant, knownObjects: known });
  if (process.argv.includes('--json')) { console.log(JSON.stringify(r, null, 1)); process.exit(r.summary.error ? 1 : 0); }
  console.log(`[rap] checks (${r.title || r.variant}): ${r.summary.error} error(s), ${r.summary.warning} warning(s), ${r.summary.info} info(s) in ${r.files} source(s), ${r.ms} ms${r.summary.fixable ? `; ${r.summary.fixable} can be fixed automatically (--fix)` : ''}`);
  for (const cat of r.categories) {
    const list = r.findings.filter(x => x.category === cat);
    if (!list.length) continue;
    console.log(`\n${cat}`);
    for (const x of list) console.log(`  ${x.severity.padEnd(7)} ${x.file}:${x.line}  ${x.message}  [${x.rule}${x.fix ? ', fixable' : ''}]`);
  }
  process.exit(r.summary.error ? 1 : 0);
}
if (cmd === 'deliver') {
  const { deliver } = await import('../src/deliver/deliver.js');
  const m = await deliver(dir, { fix: !process.argv.includes('--no-fix'), describe: !process.argv.includes('--no-description') });
  console.log(`[rap] tests: ${m.tests.passed} of ${m.tests.total} passed${m.tests.failed ? `, ${m.tests.failed} FAILED` : ''}${m.tests.screenshots ? `, ${m.tests.screenshots} screenshot(s)` : ''}`);
  process.exit(m.tests.failed || m.atc.after.error ? 1 : 0);
}
if (cmd === 'catalog') {
  const { systemDirOf, systemCatalog, describeCatalog } = await import('../src/rap/catalog.js');
  const sys = systemDirOf(process.cwd());
  if (!sys) { console.log('This app is not part of a RAP Studio system (no other apps to reuse).'); process.exit(0); }
  const rows = describeCatalog(systemCatalog(sys, process.cwd()), process.argv.slice(3).join(' '));
  console.log(rows.length ? rows.join('\n') : 'Nothing found. Search with other words, or create the object in this app.');
  process.exit(0);
} else if (cmd === 'odata') {
  // only ever talks to this app on the local studio: http://localhost:<port>/a/<app>/odata/<path>
  const [, method = 'GET', rel = '', body] = process.argv.slice(2);
  const app = process.env.RAP_APP || path.basename(process.cwd());
  const port = Number(process.env.RAP_PORT || flag('--port', 4004));
  const url = `http://localhost:${port}/a/${encodeURIComponent(app)}/odata/${rel.replace(/^\/?(odata\/)?/, '')}`;
  const headers = { Accept: 'application/json' };
  if (body && !body.startsWith('--')) headers['Content-Type'] = 'application/json';
  if (flag('--user')) headers['x-rap-user'] = flag('--user');
  try {
    const r = await fetch(url, { method: method.toUpperCase(), headers, body: body && !body.startsWith('--') ? body : undefined });
    const t = await r.text();
    console.log(`HTTP ${r.status}`);
    let out = t; try { out = JSON.stringify(JSON.parse(t), null, 1); } catch {}
    console.log(out.length > 6000 ? out.slice(0, 6000) + '\n… (truncated)' : out);
    process.exit(r.status >= 400 ? 1 : 0);
  } catch (e) { console.log(`Cannot reach the studio at ${url}: ${e.message}`); process.exit(1); }
} else if (cmd === 'user' || cmd === 'role' || cmd === 'users') {
  const { authStoreFor, USERS_FILE } = await import('../src/server/auth.js');
  const { systemDirOf } = await import('../src/rap/catalog.js');
  const fs = await import('node:fs');
  // users belong to the system (the apps folder): an app folder inside a system uses the system's users
  const home = fs.existsSync(path.join(dir, '.rap-system.json')) ? dir : (systemDirOf(dir) || dir);
  const store = authStoreFor(home);
  const rest = process.argv.slice(5).filter((x, i, a) => !x.startsWith('--') && !(a[i - 1] || '').match(/^--(password|role|name|top)$/));
  if (cmd === 'users') {
    const d = store.load();
    console.log(`${path.join(path.resolve(home), USERS_FILE)}${store.enabled ? '' : ' (no users: development mode, no login)'}`);
    for (const [n, u] of Object.entries(d.users)) console.log(`  ${n.padEnd(12)} ${u.admin ? 'admin ' : ''}${(u.roles || []).join(', ')}${u.fullName ? `  (${u.fullName})` : ''}`);
    for (const [r, objs] of Object.entries(d.roles)) console.log(`  role ${r}: ${Object.entries(objs).map(([o, inst]) => `${o} ${inst.map(i => JSON.stringify(i)).join(' ')}`).join('; ')}`);
  } else if (cmd === 'user') {
    if (!arg) { console.error('usage: rap user <dir> <name> [--password pw] [--role R1,R2] [--name "Full Name"] [--admin] [--delete]'); process.exit(1); }
    if (process.argv.includes('--delete')) { store.deleteUser(arg); console.log(`[rap] user ${arg.toUpperCase()} deleted`); process.exit(0); }
    const n = store.setUser(arg, { password: flag('--password'), fullName: flag('--name'), roles: flag('--role') ? flag('--role').split(',') : undefined, admin: process.argv.includes('--admin') ? true : undefined });
    console.log(`[rap] user ${n} saved in ${path.join(path.resolve(home), USERS_FILE)}`);
  } else {
    const [object, ...vals] = rest;
    if (!arg || !object || !vals.length) { console.error('usage: rap role <dir> <ROLE> <AUTH_OBJECT> FIELD=v1,v2 [FIELD=...]'); process.exit(1); }
    store.grant(arg, object, Object.fromEntries(vals.map(v => { const [f, x = ''] = v.split('='); return [f, x.split(',')]; })));
    console.log(`[rap] role ${arg.toUpperCase()}: authorization for ${object.toUpperCase()} added`);
  }
  process.exit(0);
} else if (cmd === 'gui') {
  const { buildClassic, classicAvailable } = await import('../src/classic/build.mjs');
  if (!classicAvailable()) { console.error('The classic ABAP engine is not installed: npm run setup:open-abap'); process.exit(1); }
  // the RAP runtime creates and seeds the app's tables first; the classic engine shares the database
  const ws = new Workspace(dir, { lint: false });
  ws.close();
  const r = await buildClassic(dir, { log: m => console.log(`[rap] ${m}`) });
  for (const d of r.diagnostics) console.log(`  ${d.severity === 'error' ? 'ERROR  ' : 'warning'} ${d.file}${d.line ? ':' + d.line : ''}  ${d.message}`);
  if (!r.ok) process.exit(1);
  console.log(`[rap] ${r.programs.length} program(s): ${r.programs.map(p => p.name).join(', ') || '-'}`);
  if (process.argv.includes('--build-only')) process.exit(0);
  const { spawn } = await import('node:child_process');
  const host = spawn(process.execPath, [new URL('../src/classic/host.mjs', import.meta.url).pathname, path.join(path.resolve(dir), '.rap', 'classic'), String(flag('--port', 4005))],
    { stdio: 'inherit', env: { ...process.env, RAP_CLASSIC_DB: path.join(path.resolve(dir), '.rap', 'data.db') } });
  host.on('exit', code => process.exit(code ?? 0));
} else if (cmd === 'abapgit') {
  const { writeAbapGit } = await import('../src/studio/abapgit.js');
  if (!arg) { console.error('usage: rap abapgit <dir> <out-dir> [--package ZPKG]'); process.exit(1); }
  const files = writeAbapGit(path.resolve(dir), path.resolve(arg), { packageName: flag('--package') });
  console.log(`[rap] wrote ${files.length} files to ${path.resolve(arg)} (abapGit layout; pull it into a package with abapGit / ADT)`);
  process.exit(0);
} else if (cmd === 'events') {
  const ws = new Workspace(dir, { lint: false });
  const ev = ws.odata.rap.events(Number(flag('--top', 20)));
  if (!ev.length) console.log('No business events raised yet.');
  for (const e of ev) console.log(`${e.raised_at}  ${e.entity}~${e.event}  by ${e.raised_by}  ${JSON.stringify(e.payload)}`);
  ws.close();
  process.exit(0);
} else if (!cmd || cmd === 'studio') {
  const port = Number(flag('--port', 4004));
  const appsDir = (cmd === 'studio' ? ARGS[1] : null) || 'apps';
  if (flag('--db')) process.env.RAP_DB = flag('--db');
  const host = flag('--host', '127.0.0.1');
  const studio = new Studio(appsDir, { port, model: flag('--model'), host });
  studio.listen();
  console.log(`[rap] RAP Studio        http://localhost:${port}/   (apps in ${path.resolve(appsDir)})`);
  exposedWarning(host, studio.dir);
} else await main();

async function main() {
// check activates into an in-memory database so it never touches the app's persisted data
const dbUrl = flag('--db') || process.env.RAP_DB;
const ws = new Workspace(dir, { lint: !process.argv.includes('--no-lint'), ...(cmd === 'check' || cmd === 'test' ? { dbUrl: dbUrl?.startsWith('postgres') ? dbUrl : (dbUrl?.startsWith('pglite') ? 'pglite:memory' : 'sqlite:memory') } : dbUrl ? { dbUrl } : {}) });
const d = ws.app.diagnostics;
// rap check: also what runs here but would not activate or run on an SAP system (unknown customer types, objects not
// released for ABAP Cloud, COMMIT WORK in behavior pools) - warnings, the local activation itself is unchanged
if (cmd === 'check' && !process.argv.includes('--no-lint')) {
  try {
    const { sapReadiness } = await import('../src/check/atc.js');
    for (const f of sapReadiness(dir, { knownObjects: ws.knownObjects() })) d.warnings.push({ file: f.file, line: f.line, message: `${f.message} [${f.rule}]` });
  } catch (e) { d.warnings.push({ file: '', line: null, message: `The SAP readiness checks could not run: ${e.message}` }); }
}
const s = ws.summary().objects;
console.log(`[rap] activated ${path.resolve(dir)} in ${ws.activationMs} ms: ${s.tables.length} tables, ${s.views.length} views, ${s.behaviors.length} behavior definitions, ${s.classes.length} classes, ${s.services.length} services; ${d.errors.length} error(s), ${d.warnings.length} warning(s)`);
print(d);

if (cmd === 'check') process.exit(d.errors.length ? 1 : 0);
if (cmd === 'appjobs') {
  // application jobs of the app (cl_apj_rt_api): the list; --run runs the ones that are due now
  if (process.argv.includes('--run')) console.log(`[rap] ${ws.runDueJobs()} job(s) run`);
  ws.app.rt.backgroundTables?.();
  const jobs = ws.app.db.prepare('SELECT * FROM rap_apj_job ORDER BY start_at DESC LIMIT 50').all();
  if (!jobs.length) console.log('No application jobs yet.');
  for (const j of jobs) console.log(`${j.jobname.padEnd(32)} ${j.jobcount}  ${({ S: 'scheduled', R: 'running', F: 'finished', A: 'aborted', C: 'cancelled' })[j.status] || j.status}  ${j.class.toUpperCase()}  start ${new Date(j.start_at).toISOString().slice(0, 19).replace('T', ' ')}${j.period_min ? `  every ${j.period_min} min` : ''}${j.message ? `  ${j.message}` : ''}${j.log_handle ? `  log ${j.log_handle}` : ''}`);
  process.exit(0);
}
if (cmd === 'run') {
  if (process.argv.includes('--trace')) { ws.app.rt.sqlTrace = true; ws.app.rt.sqlTraceLog = []; }
  const r = ws.runClass(arg);
  console.log(r.output);
  if (process.argv.includes('--trace')) {
    console.log(`\nSQL trace (${ws.app.rt.sqlTraceLog.length} statements):`);
    for (const t of ws.app.rt.sqlTraceLog) console.log(`  ${String(t.ms ?? '').padStart(4)} ms ${String(t.rows ?? '').padStart(5)} rows  ${t.abap || ''}  ${String(t.sql).replace(/\s+/g, ' ').slice(0, 160)}${t.params?.length ? `  [${t.params.join(', ')}]` : ''}`);
  }
  if (!r.ok) { console.error(`\n${r.error}${r.dump ? `\nRuntime error ${r.dump}: rap dump . ${r.dump}` : ''}`); process.exit(1); }
  process.exit(0);
}
if (cmd === 'dumps' || cmd === 'dump') {
  const { listDumps, getDump } = await import('../src/server/dumps.js');
  if (cmd === 'dumps') {
    const list = listDumps(ws, Number(flag('--top', 20)));
    if (!list.length) console.log('No runtime errors.');
    for (const d of list) console.log(`${String(d.id).padStart(4)}  ${new Date(Number(d.created)).toISOString().slice(0, 19).replace('T', ' ')}  ${d.exception}  ${d.message}  (${d.context}${d.file ? `, ${d.file}:${d.line}` : ''})`);
  } else {
    const d = getDump(ws, arg);
    if (!d) { console.log(`Runtime error ${arg} does not exist`); process.exit(1); }
    console.log(`${d.exception}: ${d.message}\n${d.context}, ${d.username}, ${new Date(Number(d.created)).toISOString()}\nCall stack:`);
    for (const f of d.frames) console.log(`  ${f.cls.toUpperCase()}${f.method ? `->${f.method.toUpperCase()}` : ''}  ${f.file ? `${f.file}:${f.line}` : ''}`);
    if (d.source.length) { console.log('Source:'); for (const x of d.source) console.log(`${x.line === d.line ? '>' : ' '}${String(x.line).padStart(5)}  ${x.text}`); }
  }
  process.exit(0);
}
if (cmd === 'debug') {
  // the debugger without a screen: run, and at every stop print where, the variables and the call stack
  const breaks = process.argv.flatMap((a, i) => (a === '--break' ? [process.argv[i + 1]] : []));
  const max = Number(flag('--max', 20));
  const show = (v, depth = 0) => {
    if (!v || typeof v !== 'object') return String(v);
    if (v.t === 'table') return `table, ${v.lines ?? v.rows?.length ?? 0} line(s)${depth < 1 && v.rows?.length ? `: ${v.rows.slice(0, 3).map(r => show(r, depth + 1)).join(' | ')}${v.rows.length > 3 ? ' | …' : ''}` : ''}`;
    if (v.comps) return `{ ${Object.entries(v.comps).slice(0, 8).map(([k, c]) => `${k}: ${show(c, depth + 1)}`).join(', ')} }`;
    if (v.t === 'ref' || v.t === 'object') return `${v.t} ${v.v ?? ''}`.trim();
    return JSON.stringify(v.v);
  };
  ws.debugStart({ kind: 'class', name: arg, breakpoints: breaks });
  const until = async () => { for (;;) { const st = ws.debugState(); if (st.status === 'paused' || st.status === 'done') return st; await new Promise(r => setTimeout(r, 20)); } };
  let n = 0;
  for (;;) {
    const st = await until();
    if (st.status === 'done') {
      const r = st.result || {};
      console.log(r.ok === false ? `Ended with ${r.error}` : r.stopped ? 'Stopped' : 'Ended');
      if (r.output) console.log(`Output:\n${r.output}`);
      break;
    }
    const p = st.paused;
    console.log(`--- stop ${++n} at ${p.file}:${p.line}  (${(p.stack || []).join(' <- ')})`);
    for (const [k, v] of Object.entries(p.vars || {})) console.log(`  ${k.padEnd(20)} ${show(v)}`);
    if (n >= max) { console.log(`(${max} stops: stopping; --max for more)`); ws.debugCommand('stop'); await until(); break; }
    ws.debugCommand('continue');
  }
  ws.debugStop();
  process.exit(0);
}
if (cmd === 'system') {
  const tables = ws.systemTables();
  if (!arg) { for (const t of tables) console.log(`${t.padEnd(20)} ${ws.app.db.prepare(`SELECT COUNT(*) AS n FROM "${t}"`).get().n} record(s)`); if (!tables.length) console.log('No runtime records yet.'); process.exit(0); }
  const t = tables.find(x => x === arg.toLowerCase() || x.replace(/^(rap_|zrap_)/, '') === arg.toLowerCase());
  if (!t) { console.log(`No records ${arg}; there are: ${tables.join(', ') || 'none'}`); process.exit(1); }
  const rows = ws.app.db.prepare(`SELECT * FROM "${t}" ORDER BY 1 DESC LIMIT ?`).all(Number(flag('--top', 20)));
  for (const r of rows) console.log(Object.entries(r).map(([k, v]) => `${k}=${Buffer.isBuffer(v) || v instanceof Uint8Array ? `<${v.length} bytes>` : String(v ?? '').replace(/\s+/g, ' ').slice(0, 80)}`).join('  '));
  process.exit(0);
}
if (cmd === 'fiori') {
  const service = flag('--service') || s.services[0]?.name;
  const srv = ws.app.model.services.get(String(service).toLowerCase());
  if (!srv) { console.error(`Service ${service} not found`); process.exit(1); }
  const entitySet = flag('--entity') || srv.exposes[0].alias;
  const r = generateFioriApp(ws.dir, { template: flag('--template', 'lrop'), service: srv.name, entitySet, name: flag('--name'), title: flag('--title'), uiMetadata: ws.odata.uiMetadata(srv) });
  console.log(`[rap] generated ${TEMPLATES[flag('--template', 'lrop')]} app ${r.path} (served at ${r.url})`);
  process.exit(0);
}
if (cmd === 'test') {
  if (d.errors.length) process.exit(1);
  const r = ws.runTests(arg);
  for (const t of r.results) console.log(`  ${{ passed: 'PASS ', failed: 'FAIL ', error: 'ERROR', skipped: 'SKIP ' }[t.status]} ${t.cls}->${t.method}${t.message ? `  ${t.message}` : ''}`);
  console.log(`[rap] ${r.passed} passed, ${r.failed} failed, ${r.errors} errors${r.skipped ? `, ${r.skipped} skipped` : ''} (${r.ms} ms)`);
  process.exit(r.ok && r.results.length ? 0 : 1);
}
if (cmd === 'js') { console.log(ws.generatedCode(arg) ?? `class ${arg} not found`); process.exit(0); }
if (cmd === 'serve') {
  const port = Number(flag('--port', 4004));
  const host = flag('--host', '127.0.0.1');
  startServer(ws, port, { host });
  exposedWarning(host, ws.opts?.systemDir || ws.dir);
  // Ctrl+C / SIGTERM: close the workspace (job scheduler, watchers, database) with the server
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => {
    try { ws.close(); } catch {}
    process.exit(0);
  });
  console.log(`[rap] Fiori launchpad   http://localhost:${port}/`);
  for (const svc of s.services) console.log(`[rap] OData service    http://localhost:${port}/odata/${svc.name.toLowerCase()}/  (${svc.entitySets.join(', ')})`);
}
}

// --host makes the server reachable from other machines: without users anyone there can change the apps
function exposedWarning(host, dir) {
  if (['127.0.0.1', 'localhost', '::1'].includes(host)) return;
  console.log(`[rap] listening on ${host}: other machines can reach this server.`);
  try { if (!JSON.parse(fs.readFileSync(path.join(dir, '.rap-users.json'), 'utf8'))?.users || !Object.keys(JSON.parse(fs.readFileSync(path.join(dir, '.rap-users.json'), 'utf8')).users).length) throw 0; }
  catch { console.log('[rap] WARNING: no users are set up, so anyone who can reach it can build and run code. Create an administrator first: rap user <apps-dir> <name> --password <pw> --admin'); }
}
