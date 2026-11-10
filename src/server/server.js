// HTTP server: Fiori-like UI, OData services, workspace API and live re-activation on file changes.
// A Workspace is one RAP application folder (abapGit layout) with its own SQLite database in .rap/data.db.
// `rap serve <dir>` serves one workspace at "/"; the studio (src/studio) hosts many under "/a/<app>/".
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { activate, listSources } from '../rap/model.js';
import { ODataService, userOf } from './odata.js';
import { recordDump, listDumps, getDump, clearDumps } from './dumps.js';
import { renderForm, formStore } from '../forms/engine.js';
import { checkForms } from '../forms/check.js';
import { renderXdp } from '../forms/xfa/render.js';
import { Worker } from 'node:worker_threads';
import { ODataV2 } from './odata-v2.js';
import { v2ExplorerPage } from './odata-v2-explorer.js';
import { RapError, RapRuntime } from '../rap/rap.js';
import { syntaxCheck } from '../check/abaplint.js';
import { runAtc, fixAtc, ruleDoc, listVariants } from '../check/atc.js';
import { clean, restore, cleanerAvailable } from '../check/cleaner.js';
import { authStoreFor, authGate, requestGuard } from './auth.js';
import { settingsOf, setSettings } from './usersettings.js';
import { ClassicEngine } from '../classic/manager.mjs';
import { hasClassicSources, classicAvailable } from '../classic/build.mjs';
import { STANDARD_DIR } from '../rap/catalog.js';
import { KINDS, objectFiles, rapBoFiles, appContext } from './generate.js';
import { generateXdp } from '../forms/xfa/generate.js';
import { loadInterface, resolveParams, interfaceXsd, interfaceSample, signature } from '../forms/interface.js';
import { generateFioriApp } from '../studio/fiori.js';
import { codeintelRoute } from './codeintel.js';

export const UI_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'ui');
export const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.xml': 'application/xml; charset=utf-8', '.properties': 'text/plain; charset=utf-8' };

// the SAP standard layer's database (standard/s4hana/.rap): created and seeded once, before an app reads from it
let standardReady = false;
export function ensureStandard(opts = {}) {
  const url = opts.dbUrl || process.env.RAP_DB || '';
  if (standardReady || opts.standard === false || /^pglite/i.test(url)) return;   // embedded PostgreSQL: one database per app, no sharing
  standardReady = true;
  // activated again when the standard layer changed (new tables and views are created and seeded)
  const stampFile = path.join(STANDARD_DIR, '.rap', 'catalog.stamp');
  let stamp = '';
  try { stamp = String(fs.statSync(path.join(STANDARD_DIR, 'catalog.json')).mtimeMs); } catch {}
  const file = !url || /^sqlite/i.test(url);   // SQLite apps (also in-memory ones) attach the standard layer's file
  if (file && fs.existsSync(path.join(STANDARD_DIR, '.rap', 'data.db')) && (() => { try { return fs.readFileSync(stampFile, 'utf8') === stamp; } catch { return false; } })()) return;
  // generated, read-only data: rebuilt from scratch when the layer changed
  if (file) for (const f of ['data.db', 'data.db-shm', 'data.db-wal']) try { fs.rmSync(path.join(STANDARD_DIR, '.rap', f), { force: true }); } catch {}
  const ws = new Workspace(STANDARD_DIR, { lint: false, standard: false, ...(file ? { dbFile: path.join(STANDARD_DIR, '.rap', 'data.db') } : { dbUrl: url }) });
  ws.close();
  if (file) try { fs.writeFileSync(stampFile, stamp); } catch {}
}

export class Workspace {
  constructor(dir, opts = {}) {
    this.dir = path.resolve(dir);
    this.opts = opts;
    if (this.dir !== STANDARD_DIR) ensureStandard(opts);
    this.app = null;
    this.odata = null;
    this.version = 0;
    this.activatedAt = null;
    this.listeners = new Set();
    this.activate();
  }
  // what the ABAP runtime needs to run this app's reports and transactions on its classic engine
  classicInfo() {
    const dbFile = this.opts.dbFile && this.opts.dbFile !== ':memory:' ? this.opts.dbFile : path.join(this.dir, '.rap', 'data.db');
    const memory = this.app?.db?.kind !== 'sqlite' || this.opts.dbFile === ':memory:' || /memory/.test(this.opts.dbUrl || process.env.RAP_DB || '');
    return { appDir: this.dir, dbFile, memory, url: this._classic?.state === 'running' && this._classic.port ? `http://localhost:${this._classic.port}/` : null };
  }
  // the state of the sources (names, sizes, change times): an activation of the same state is not repeated
  sourceState() {
    try { return listSources(this.dir).map(f => { const st = fs.statSync(f); return `${f}:${st.size}:${st.mtimeMs}`; }).join('|'); } catch { return String(Math.random()); }
  }
  activate() {
    this.activatedState = this.sourceState();
    const t0 = Date.now();
    const trace = { on: this.app?.rt?.sqlTrace, log: this.app?.rt?.sqlTraceLog };   // the SQL trace survives re-activation
    try { this.app?.db?.close(); } catch {}
    try {
      this.app = activate(this.dir, this.opts);
      this.app.rt.classicInfo = () => this.classicInfo();
      this.app.rt.sqlTrace = trace.on; if (trace.log) this.app.rt.sqlTraceLog = trace.log;
    } catch (e) {
      // keep the server alive; report the failure as a diagnostic
      this.app = activate(this.dir, { ...this.opts, dbFile: ':memory:' });
      this.app.diagnostics.errors.push({ file: '', line: null, message: `Activation failed: ${e.message}` });
    }
    if (this.opts.lint !== false) {
      try {
        const m = this.app.model;
        const lint = syntaxCheck(this.dir, { knownObjects: new Set([...m.tables.keys(), ...m.entities.keys()]) });
        this.app.diagnostics.errors.push(...lint.errors);
        this.app.diagnostics.warnings.push(...lint.warnings);
      } catch (e) { this.app.diagnostics.warnings.push({ file: '', line: null, message: `abaplint could not run: ${e.message}` }); }
    }
    // print form layouts
    try {
      for (const f of checkForms(this.dir, this.app.model)) this.app.diagnostics[f.severity === 'error' ? 'errors' : 'warnings'].push({ file: f.file, line: f.line, message: f.message });
    } catch (e) { this.app.diagnostics.warnings.push({ file: '', line: null, message: `The print forms could not be checked: ${e.message}` }); }
    this.odata = new ODataService(this.app);
    // uncaught exceptions of ABAP code: runtime errors (OData requests, application jobs, background processes)
    this.odata.onError = (e, context) => recordDump(this, e, context);
    this.app.rt.onError = (e, context) => recordDump(this, e, context);
    this.odatav2 = new ODataV2(this.odata);
    this.auth = authStoreFor(this.opts.systemDir || this.dir);
    this.odata.authStore = this.auth;
    this.version++;
    // the number shown as "Active · vN": one per activation of changed sources (classic builds and a re-activation
    // of the same sources refresh the views through version, but are no new activation)
    const state = this.activatedState;
    if (state !== this.countedState) { this.activation = (this.activation || 0) + 1; this.countedState = state; }
    this.activatedAt = new Date().toISOString();
    this.activationMs = Date.now() - t0;
    for (const l of this.listeners) { try { l(this); } catch {} }
    return this.app.diagnostics;
  }
  // re-activate when sources change (debounced)
  watch(log = false) {
    if (this.watcher) return;
    let timer = null;
    try {
      this.watcher = fs.watch(this.dir, { recursive: true }, (_e, file) => {
        if (!file || file.startsWith('.rap') || file.includes('node_modules') || file.endsWith('~') || file.startsWith('.git')) return;
        clearTimeout(timer);
        timer = setTimeout(() => {
          // the app folder was removed: stop watching instead of re-activating
          if (!fs.existsSync(this.dir)) { this.close(); this.removed = true; return; }
          // a save followed by Activate (or an editor that rewrote a file unchanged): activated already
          if (this.sourceState() === this.activatedState) return;
          const d = this.activate();
          if (this._classic?.proc) this._classic.ensure().catch(() => {});   // rebuild running classic programs
          if (log) {
            console.log(`[rap] re-activated ${path.basename(this.dir)} (${file}): ${d.errors.length} error(s), ${d.warnings.length} warning(s)`);
            for (const e of d.errors) console.log(`  ERROR ${e.file}${e.line ? ':' + e.line : ''} ${e.message}`);
          }
        }, 300);
      });
    } catch { /* recursive watch unsupported */ }
  }
  // ABAP cleaner on the app's sources (or one file); if the result does not activate, the files are restored
  cleanUp(file) {
    const errorsBefore = this.app.diagnostics.errors.length;
    const r = clean(this.dir, { file });
    if (!r.files.length) return { ok: true, files: [], stats: r.stats };
    this.activate();
    if (this.app.diagnostics.errors.length > errorsBefore) {
      const errors = this.app.diagnostics.errors.slice(0, 5);
      restore(this.dir, r.before);
      this.activate();
      return { ok: false, files: [], undone: r.files, stats: r.stats, errors };
    }
    return { ok: true, files: r.files, stats: r.stats };
  }
  // tables and entities of the app (with the ones it uses from other apps and the standard layer)
  knownObjects() { const m = this.app?.model; return new Set(m ? [...m.tables.keys(), ...m.entities.keys()] : []); }
  close() { this.debugStop(); clearInterval(this.jobTimer); try { this.watcher?.close(); } catch {} this._classic?.stop(); try { this.app?.db?.close(); } catch {} }
  // application jobs that are due run in a RAP context of their own; the studio calls this every 5 seconds
  runDueJobs(at) {
    const rap = this.app.rap ??= new RapRuntime(this.app);   // the app's one RAP runtime (a second one would take over rt.eml)
    rap.begin();
    try { return this.app.rt.runDueJobs?.(at) || 0; } finally { rap.end(); }
  }
  startJobScheduler() {
    clearInterval(this.jobTimer);
    this.jobTimer = setInterval(() => { try { this.runDueJobs(); } catch (e) { if (process.env.RAP_DEBUG) console.error(e); } }, 5000);
    this.jobTimer.unref?.();
  }
  // the debugger: one session per app, in a worker (debug-worker.mjs) that stops at breakpoints and steps
  debugStart({ kind = 'class', name, filter, breakpoints = [], first = false, watches = [] } = {}) {
    if (kind === 'classic') return this.classicDebugStart({ name, breakpoints, first, watches });
    this.debugStop();
    const memory = this.opts.dbFile === ':memory:' || this.app?.db?.kind !== 'sqlite';
    const s = { id: Date.now().toString(36), kind, name, status: kind === 'rap' ? 'armed' : 'running', paused: null, result: null, inspected: {}, requests: new Map(), seq: 0 };
    const worker = new Worker(new URL('./debug-worker.mjs', import.meta.url), { workerData: { dir: this.dir, systemDir: this.opts.systemDir, kind, name, filter, breakpoints, watches, trace: !!this.app.rt.sqlTrace,
      dbFile: kind === 'tests' || memory ? ':memory:' : (this.opts.dbFile || path.join(this.dir, '.rap', 'data.db')) } });
    s.worker = worker;
    worker.on('message', m => {
      if (m.type === 'paused') { s.status = 'paused'; s.paused = m; s.inspected = {}; }
      else if (m.type === 'armed') s.status = 'armed';
      else if (m.type === 'response') {   // a RAP app's OData request served by the debugger (kind rap)
        const done = s.requests.get(m.id); s.requests.delete(m.id);
        if (s.status !== 'done') { s.status = 'armed'; s.paused = null; s.last = { at: Date.now() }; }
        done?.(m.r);
      }
      else if (m.type === 'running') { s.status = 'running'; s.paused = null; }
      else if (m.type === 'inspect') s.inspected[`${m.name}/${m.path.join('/')}`] = m.value;
      else if (m.type === 'done') {
        s.status = 'done'; s.paused = null; s.result = m.result;
        if (m.trace?.length) { const log = (this.app.rt.sqlTraceLog ||= []); log.push(...m.trace); if (log.length > 1000) log.splice(0, log.length - 1000); }
      }
    });
    worker.on('error', e => { s.status = 'done'; s.result = { error: e.message }; });
    worker.on('exit', () => {
      if (s.status !== 'done') { s.status = 'done'; s.result ||= { stopped: true }; }
      for (const done of s.requests.values()) done({ status: 503, body: { error: { code: '503', message: 'The debugger was stopped' } } });
      s.requests.clear();
    });
    this.debug = s;
    return this.debugState();
  }
  debugState() {
    const s = this.debug;
    if (!s) return { status: 'none' };
    if (s.kind === 'classic' && s.status !== 'done') return this.classicDebugState();
    const { worker, requests, ...state } = s;
    return state;
  }
  // an OData request of the app while a RAP debug session is armed: the debugger's worker serves it
  get rapDebugging() { return this.debug?.kind === 'rap' && this.debug.status !== 'done'; }
  rapDebugRequest(op, args) {
    const s = this.debug, id = ++s.seq;
    return new Promise(resolve => { s.requests.set(id, resolve); s.status = 'running'; s.worker.postMessage({ type: 'odata', id, op, args }); });
  }
  // classic programs (reports, module pools, function modules) run in the classic engine's process: the debugger
  // there (src/classic/debug.mjs) stops the dialog step of the preview that reaches a breakpoint; the session stays
  // armed until it is stopped, for every run of the app's programs in the preview
  async classicDebugStart({ name, breakpoints = [], first = false, watches = [] }) {
    this.debugStop();
    const s = { id: Date.now().toString(36), kind: 'classic', name, status: 'armed', paused: null, result: null, breakpoints, first, watches };
    this.debug = s;
    const st = await this.classic.ensure();
    if (st.state !== 'running') { s.status = 'done'; s.result = { error: 'The classic programs did not build: see Problems' }; return this.debugState(); }
    await this.classicDebugCall('/__rap/debug', { active: true, breakpoints, first, watches }).catch(() => {});
    s.port = this.classic.port;
    return this.debugState();
  }
  async classicDebugCall(p, body) {
    if (!this._classic?.port) throw new Error('The classic engine is not running');
    const r = await fetch(`http://127.0.0.1:${this._classic.port}${p}`, body ? { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } } : {});
    return r.json();
  }
  async classicDebugState() {
    const s = this.debug;
    try {
      let st = await this.classicDebugCall('/__rap/debug');
      // a new engine process (the programs were rebuilt): it gets the breakpoints again
      if (!st.active || s.port !== this._classic.port) { st = await this.classicDebugCall('/__rap/debug', { active: true, breakpoints: s.breakpoints, watches: s.watches }); s.port = this._classic.port; }
      Object.assign(s, { status: st.status, paused: st.paused, last: st.last, resolved: st.resolved, bound: st.bound });
    } catch { s.status = 'armed'; s.paused = null; }   // the engine is (re)building
    return { ...s };
  }
  async classicDebugCommand(cmd, extra) {
    const s = this.debug;
    if (cmd === 'breakpoints') { s.breakpoints = extra.breakpoints || []; await this.classicDebugCall('/__rap/debug', { breakpoints: s.breakpoints }).catch(() => {}); return this.debugState(); }
    if (cmd === 'inspect') return this.debugState();
    if (cmd === 'watches' || cmd === 'set') {
      if (cmd === 'watches') s.watches = extra.watches || [];
      const st = await this.classicDebugCall('/__rap/debug/cmd', { cmd, ...extra }).catch(() => null);
      if (st) Object.assign(s, { status: st.status, paused: st.paused });
      return { ...s };
    }
    if (cmd === 'stop') {
      await this.classicDebugCall('/__rap/debug/cmd', { cmd: 'stop' }).catch(() => {});
      await this.classicDebugCall('/__rap/debug', { active: false }).catch(() => {});
      Object.assign(s, { status: 'done', paused: null, result: { stopped: true } });
      return { ...s };
    }
    await this.classicDebugCall('/__rap/debug/cmd', { cmd }).catch(() => {});
    s.status = 'running'; s.paused = null;
    return { ...s };
  }
  debugCommand(cmd, extra = {}) {
    const s = this.debug;
    if (!s || s.status === 'done') return this.debugState();
    if (s.kind === 'classic') return this.classicDebugCommand(cmd, extra);
    s.worker.postMessage({ cmd, ...extra });
    if (!['breakpoints', 'inspect', 'set', 'watches'].includes(cmd)) { s.status = cmd === 'stop' ? 'stopping' : 'running'; s.paused = null; }
    return this.debugState();
  }
  debugStop() {
    if (this.debug?.kind === 'classic') { if (this.debug.status !== 'done') { this.debug.status = 'done'; this.classicDebugCall('/__rap/debug', { active: false }).catch(() => {}); } return; }
    // (the timer ends this session's worker: by then this.debug may be the next session)
    if (this.debug && this.debug.status !== 'done') { const w = this.debug.worker; try { w.postMessage({ cmd: 'stop' }); } catch {} setTimeout(() => w?.terminate?.(), 2000).unref?.(); } }
  // the runtime's own tables of this app (application jobs, logs, background processes, mail outbox) that exist
  systemTables() {
    const names = ['rap_apj_job', 'zrap_balhdr', 'zrap_balmsg', 'rap_bgpf_process', 'rap_mail_outbox', 'rap_nr_interval', 'rap_job', 'rap_output'];
    return names.filter(n => { try { this.app.db.prepare(`SELECT 1 FROM "${n}" LIMIT 1`).all(); return true; } catch { return false; } });
  }
  // classic ABAP engine (reports, module pools, function groups) on this app's database
  get classic() {
    if (!this._classic) {
      this._classic = new ClassicEngine(this.dir, { systemDir: this.opts.systemDir, dbFile: this.app?.db?.kind === 'sqlite' && this.opts.dbFile !== ':memory:' ? (this.opts.dbFile || path.join(this.dir, '.rap', 'data.db')) : null });
      this._classic.onBuilt = () => { this.version++; };   // Problems shows the build's diagnostics
    }
    return this._classic;
  }
  // the activation's diagnostics and those of the classic engine's last build (conversion of reports and module
  // pools, transpiling, debugger instrumentation), at their source file and line
  allDiagnostics() {
    const d = this.app.diagnostics, c = this._classic?.state && this._classic.state !== 'idle' ? this._classic.diagnostics || [] : [];
    if (!c.length) return d;
    const tag = x => ({ ...x, source: 'classic' });
    return { ...d, errors: [...d.errors, ...c.filter(x => x.severity === 'error').map(tag)], warnings: [...d.warnings, ...c.filter(x => x.severity !== 'error').map(tag)] };
  }
  summary() {
    const m = this.app.model;
    return {
      dir: this.dir, version: this.version, activation: this.activation || 1, activatedAt: this.activatedAt, activationMs: this.activationMs,
      diagnostics: this.allDiagnostics(),
      objects: {
        tables: [...m.tables.values()].map(t => ({ name: t.label, file: t.file, fields: t.fields.length })),
        views: [...m.entities.values()].filter(e => e.kind === 'view').map(e => ({ name: e.label, file: e.file, root: !!e.root, projection: e.projection, broken: !!e.broken, behavior: !!e.behavior })),
        behaviors: [...m.bos.values()].map(b => ({ name: b.name, type: b.type, file: b.file, entities: [...b.entities.values()].map(e => e.alias) })),
        classes: [...m.classes.values()].map(c => ({ name: c.name, file: c.file, superName: c.superName, classrun: c.interfaces.includes('if_oo_adt_classrun') })),
        services: [...m.services.values()].map(s => ({ name: s.label, file: s.file, entitySets: s.exposes.map(e => e.alias) })),
        structures: [...(m.structures?.values() || [])].map(t => ({ name: t.label, file: t.file, fields: t.fields.length })),
      },
      sources: listSources(this.dir).map(f => path.relative(this.dir, f)),
      systemTables: this.systemTables(),
    };
  }
  // run a class implementing if_oo_adt_classrun (like F9 in ADT)
  runClass(name) {
    const rt = this.app.rt;
    const rap = this.app.rap ??= new RapRuntime(this.app);
    rap.begin();
    const out = [];
    const writer = {
      write: (p = {}) => {
        const data = p.data !== undefined ? p.data : p.$0;
        const label = p.name ? `${p.name}:\n` : '';
        out.push(label + (data !== null && typeof data === 'object' ? formatData(data) : rt.s(data)));
        if (process.env.RAP_TRACE_OUT) process.stderr.write(`${out.at(-1).slice(0, 300)}\n`);   // see how far a run gets
        return { $ret: writer };
      },
    };
    writer.if_oo_adt_classrun_out = writer;
    rt.output = [];
    const t0 = Date.now();
    // the locks the run sets (ENQUEUE_ of the app's lock objects) are its own and end with it
    const lockOwner = rt.$lockOwner;
    rt.$lockOwner = `rap-run-${process.pid}-${t0}-${Math.random().toString(36).slice(2)}`;
    try {
      const obj = rt.new(name.toLowerCase());
      rt.call(obj, 'main', { out: writer });
      return { ok: true, output: out.join('\n'), ms: Date.now() - t0 };
    } catch (e) {
      const msg = e?.get_text ? e.get_text().$ret : e.message;
      const dump = recordDump(this, e, `Console ${name.toUpperCase()}`);
      return { ok: false, dump, output: out.join('\n'), error: `${e?.constructor?.$name ? e.constructor.$name.toUpperCase() + ': ' : ''}${msg}`, stack: e?.stack?.split('\n').slice(0, 6).join('\n'), ms: Date.now() - t0 };
    } finally { rt.releaseLocks?.(rt.$lockOwner); rt.$lockOwner = lockOwner; rap.end(); }
  }
  // ABAP Unit: every test method runs in its own database transaction that is rolled back afterwards
  runTests(filter) {
    const rt = this.app.rt, db = this.app.db, rap = this.odata.rap;
    const results = [];
    const t0 = Date.now();
    const msgOf = e => (e?.get_text ? e.get_text().$ret : e?.message || String(e));
    for (const c of this.app.model.classes.values()) {
      if (!c.forTesting) continue;
      const methods = [...c.methods.values()].filter(m => m.forTesting && (!filter || `${c.name}`.includes(filter.toLowerCase()) || m.name.includes(filter.toLowerCase())));
      if (!methods.length) continue;
      const C = rt.cls(c.name);
      db.exec('SAVEPOINT aunit_class');
      let classError = null;
      try { if (typeof C.class_setup === 'function') C.class_setup({}); } catch (e) { classError = msgOf(e); }
      for (const m of methods) {
        const r = { cls: c.localName || c.name, method: m.name, file: c.file, status: 'passed', message: '' };
        if (classError) { results.push({ ...r, status: 'error', message: `class_setup: ${classError}` }); continue; }
        db.exec('SAVEPOINT aunit_test');
        rt.injected = new Set();
        rt.sy.uname = 'DEVELOPER'; rt.auth = null;
        const ms = Date.now();
        let obj;
        try {
          obj = new C();
          if (typeof obj.$constructor === 'function') obj.$constructor({});
          if (typeof obj.setup === 'function') obj.setup({});
          obj[m.name]({});
        } catch (e) {
          r.status = rt.isA(e, 'cx_aunit_failure') ? 'failed' : rt.isA(e, 'cx_aunit_skip') ? 'skipped' : 'error';
          r.message = `${r.status === 'error' && e?.constructor?.$name ? e.constructor.$name.toUpperCase() + ': ' : ''}${msgOf(e)}`;
        } finally {
          try { if (obj && typeof obj.teardown === 'function') obj.teardown({}); } catch (e) { if (r.status === 'passed') { r.status = 'error'; r.message = `teardown: ${msgOf(e)}`; } }
          rap.end();
          rt.injected = new Set();
          try { db.exec('ROLLBACK TO aunit_test'); db.exec('RELEASE aunit_test'); } catch {}
        }
        r.ms = Date.now() - ms;
        results.push(r);
      }
      try { if (typeof C.class_teardown === 'function') C.class_teardown({}); } catch {}
      try { db.exec('ROLLBACK TO aunit_class'); db.exec('RELEASE aunit_class'); } catch {}
    }
    const count = s => results.filter(r => r.status === s).length;
    return { ok: !results.some(r => r.status === 'failed' || r.status === 'error'), passed: count('passed'), failed: count('failed'), errors: count('error'), skipped: count('skipped'), ms: Date.now() - t0, results };
  }
  generatedCode(cls) {
    const c = this.app.model.classes.get(cls.toLowerCase());
    return c ? c.js : null;
  }
  // raw database content for the data browser
  tableData(name, top = 200) {
    const m = this.app.model;
    const lname = name.toLowerCase();
    if (!m.tables.has(lname) && !m.entities.has(lname) && !this.systemTables().includes(lname)) throw new RapError(404, `No table or view ${name}`);
    const rows = this.app.db.prepare(`SELECT * FROM "${lname}" LIMIT ?`).all(top);
    const count = this.app.db.prepare(`SELECT COUNT(*) AS n FROM "${lname}"`).get().n;
    return { name: lname, count, columns: rows[0] ? Object.keys(rows[0]) : (m.tables.get(lname)?.fields || m.entities.get(lname)?.fields || []).map(f => f.name), rows };
  }
  resolveFile(rel) {
    const f = path.resolve(this.dir, rel);
    if (!f.startsWith(this.dir + path.sep) || f.includes(`${path.sep}.rap${path.sep}`)) throw new RapError(400, 'Invalid path');
    return f;
  }
}

function formatData(d) {
  if (Array.isArray(d) && d.length && typeof d[0] === 'object' && d[0] !== null) {
    const cols = [...new Set(d.flatMap(r => Object.keys(r)))];
    const w = cols.map(c => Math.min(40, Math.max(c.length, ...d.map(r => String(r[c] ?? '').length))));
    const line = r => cols.map((c, i) => String(typeof r[c] === 'object' ? JSON.stringify(r[c]) : (r[c] ?? '')).slice(0, 40).padEnd(w[i])).join(' | ');
    return [line(Object.fromEntries(cols.map(c => [c, c.toUpperCase()]))), w.map(x => '-'.repeat(x)).join('-+-'), ...d.map(line)].join('\n');
  }
  return JSON.stringify(d, null, 2);
}

// a classic form's interface (its .form.json "interface": a .sfpi.json of the app): the parameters with their
// components, the sample data of the preview (the form's "sample", else made up from the types), the schema
function formInterface(ws, form) {
  if (!form?.interface) return null;
  const itf = loadInterface(ws.dir, form.interface);
  if (!itf) throw Object.assign(new Error(`Form interface ${form.interface} does not exist (src/${String(form.interface).toLowerCase()}.sfpi.json)`), { status: 400 });
  const resolved = resolveParams([...(itf.parameters || []), ...(itf.global || [])], ws.app.model);
  return { name: itf.name, resolved, sample: form.sample || interfaceSample(resolved) };
}

export function startServer(ws, port = 4004, { host = '127.0.0.1' } = {}) {
  ws.watch(true);
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      req.rawBody = Buffer.concat(chunks);
      const body = req.rawBody.toString();
      try {
        const p = new URL(req.url, 'http://localhost').pathname;
        if (requestGuard(req, res, { host })) return;
        if (authGate(ws.auth, req, res, body)) return;
        routeWorkspace(ws, req, res, body, p, '');
      }
      catch (e) { sendError(res, e); }
    });
  });
  server.listen(port, host);
  return server;
}

// current user (draft ownership / locks): GET returns it, POST {name} switches it via cookie
// and the user's settings (date format), kept in the system directory: POST {settings: {dateFormat}} changes them
export function userRoute(req, res, body, dir = null) {
  const authenticated = !!req.headers['x-rap-auth'];
  if (req.method === 'POST') {
    let b = {};
    try { b = body ? JSON.parse(body) : {}; } catch { return send(res, 400, { error: { message: 'Invalid JSON' } }); }
    const current = userOf(req.headers);
    if (b.settings && dir) {
      try { setSettings(dir, current, b.settings); } catch (e) { return send(res, e.status || 400, { error: { message: e.message } }); }
      if (!b.name || userOf({ 'x-rap-user': b.name }) === current) return send(res, 200, { user: current, authenticated, settings: settingsOf(dir, current) });
    }
    if (authenticated) return send(res, 403, { error: { message: 'Log off and log on as the other user' } });
    const name = userOf({ 'x-rap-user': b.name || 'DEVELOPER' });
    return send(res, 200, { user: name, ...(dir ? { settings: settingsOf(dir, name) } : {}) }, { 'Set-Cookie': `rap_user=${encodeURIComponent(name)}; Path=/; SameSite=Lax` });
  }
  const user = userOf(req.headers);
  return send(res, 200, { user, authenticated, ...(dir ? { settings: settingsOf(dir, user) } : {}) });
}

export function send(res, status, body, headers = {}) {
  if (Buffer.isBuffer(body)) { res.writeHead(status, { 'OData-Version': '4.0', ...headers }); return res.end(body); }
  const isJson = body !== null && typeof body === 'object';
  res.writeHead(status, { 'Content-Type': isJson ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8', 'OData-Version': '4.0', ...headers });
  res.end(body === null ? '' : isJson ? JSON.stringify(body) : String(body));
}
export function sendError(res, e) {
  const status = e instanceof RapError ? e.status : (e?.status || 500);
  const message = e?.get_text ? e.get_text().$ret : e.message;
  if (status >= 500) console.error(e);
  if (res.headersSent) { try { res.end(); } catch {} return; }
  const details = (e.details || []).map(d => ({ code: '', message: d.text, severity: d.severity, target: d.targets?.[0] || '', targets: d.targets || [], entity: d.entity, '@Common.numericSeverity': { E: 4, W: 3, I: 2, S: 1 }[d.severity] ?? 4 }));
  send(res, status, { error: { code: String(status), message, target: details[0]?.target || '', details, '@Common.numericSeverity': 4 } });
}

// Routes of one workspace. `p` is the path below `base` (e.g. base "/a/library", p "/odata/...").
// what a logged-on user who is no administrator may use of an app's API: the user dialog, the built-in UI's overview
// and value helps, and the classic engine (its address; starting it changes no source); everything else (activate, run, debug, checks, generators, traces,
// forms design, tests) is development and needs an administrator once users exist
const END_USER_API = (p, method) => p === '/api/user' || p === '/api/classic' || (method === 'GET' && (p === '/api/workspace' || p.startsWith('/api/vh/')));

export function routeWorkspace(ws, req, res, body, p, base) {
  const url = new URL(req.url, 'http://localhost');
  const json = () => (body ? JSON.parse(body) : {});
  if (p.startsWith('/api/') && ws.auth?.enabled && !END_USER_API(p, req.method) && !ws.auth.user(req.headers['x-rap-user'])?.admin)
    return send(res, 403, { error: { message: `User ${req.headers['x-rap-user'] || ''} is not an administrator: development functions are for administrators` } });
  if (p.startsWith('/odata/')) {
    // a RAP debug session: the debugger's worker answers (and stops at the breakpoints of the behavior handlers)
    if (ws.rapDebugging) {
      const batch = /\/(\$|%24)batch$/i.test(p) && req.method === 'POST';
      const headers = { ...req.headers };
      const args = batch ? [body, headers, decodeURIComponent(p)] : [req.method, p + url.search, body ? json() : null, headers];
      return ws.rapDebugRequest(batch ? 'batch' : 'handle', args).then(r => {
        if (batch || typeof r.body === 'string') { res.writeHead(r.status, r.headers || {}); return res.end(r.body); }
        return send(res, r.status, r.body, r.headers);
      }).catch(e => send(res, 500, { error: { message: String(e?.message || e) } }));
    }
    if (/\/(\$|%24)batch$/i.test(p) && req.method === 'POST') {
      const r = ws.odata.batch(body, req.headers, decodeURIComponent(p));
      res.writeHead(r.status, r.headers);
      return res.end(r.body);
    }
    // attachments are uploaded as raw bytes (PUT .../Attachment with the file's content type)
    const binary = req.method === 'PUT' && !/json/i.test(req.headers['content-type'] || 'application/json');
    let r;
    try { r = ws.odata.handle(req.method, p + url.search, binary ? (req.rawBody || Buffer.from(body || '')) : body ? json() : null, req.headers); }
    catch (e) { if (!(e instanceof RapError)) recordDump(ws, e, `OData ${req.method} ${p}`); throw e; }
    return send(res, r.status, r.body, r.headers);
  }
  // OData V2 (SAP Gateway style URL): the same services, translated to and from V4 (odata-v2.js)
  if (p === '/sap/opu/odata/' || p === '/sap/opu/odata') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
    return res.end(v2ExplorerPage([...ws.app.model.services.values()]).replace('${base}', `${base}/sap/opu/odata/sap/`));
  }
  if (p.startsWith('/sap/opu/odata/sap/')) {
    const rest = p.slice('/sap/opu/odata/sap/'.length);
    const csrf = /^fetch$/i.test(req.headers['x-csrf-token'] || '') ? { 'x-csrf-token': 'rap-studio' } : {};
    const r = /\/(\$|%24)batch$/i.test(rest) && req.method === 'POST'
      ? ws.odatav2.batch(body, req.headers, decodeURIComponent(rest.split('/')[0]))
      : ws.odatav2.handle(req.method, rest + url.search, body && /json/i.test(req.headers['content-type'] || 'application/json') ? json() : null, { ...req.headers, 'x-rap-base': base });
    res.writeHead(r.status, { ...r.headers, ...csrf });
    return res.end(r.body === null || r.body === undefined ? '' : typeof r.body === 'string' ? r.body : JSON.stringify(r.body));
  }
  // code intelligence of the editor: completion, definition, where-used, rename, hover, outline (codeintel.js)
  if (codeintelRoute(ws, p, req, json, send, res)) return;
  // code checks (ATC-like): check variants in knowledge/checks/variants, quick fixes, explanations
  if (p === '/api/atc' && req.method === 'GET') return send(res, 200, runAtc(ws.dir, { variant: url.searchParams.get('variant') || 'default', knownObjects: ws.knownObjects() }));
  // Check of one object (the editor's content, saved or not): the code checks of that object and its activation errors
  if (p === '/api/check' && req.method === 'POST') {
    const b = json();
    const r = runAtc(ws.dir, { knownObjects: ws.knownObjects(), file: b.file, overrides: typeof b.text === 'string' ? { [b.file]: b.text } : undefined });
    const act = b.text === undefined || b.text === (fs.existsSync(ws.resolveFile(b.file)) ? fs.readFileSync(ws.resolveFile(b.file), 'utf8') : null)
      ? (ws.app?.diagnostics?.errors || []).filter(e => e.file === b.file) : [];
    return send(res, 200, { ...r, activation: act });
  }
  if (p === '/api/atc/fix' && req.method === 'POST') { const b = json(); const r = fixAtc(ws.dir, { variant: b.variant || 'default', rule: b.rule, file: b.file }); if (r.files.length) ws.activate(); return send(res, 200, r); }
  if (p === '/api/atc/variants') return send(res, 200, listVariants());
  // ABAP cleaner: the whole app or one file; undone when the cleaned code does not activate
  if (p === '/api/clean' && req.method === 'GET') return send(res, 200, { available: !!cleanerAvailable(), version: cleanerAvailable()?.version || null });
  if (p === '/api/clean' && req.method === 'POST') return send(res, 200, ws.cleanUp(json().file));
  if (p.startsWith('/api/atc/doc/')) return send(res, 200, ruleDoc(decodeURIComponent(p.slice('/api/atc/doc/'.length))));
  if (p === '/api/workspace') return send(res, 200, ws.summary());
  // SQL trace (ST05): switch on / off, the records, clear
  if (p === '/api/trace' && req.method === 'GET') return send(res, 200, { on: !!ws.app.rt.sqlTrace, records: (ws.app.rt.sqlTraceLog || []).slice(-500).reverse() });
  if (p === '/api/trace' && req.method === 'POST') { ws.app.rt.sqlTrace = !!json().on; return send(res, 200, { on: ws.app.rt.sqlTrace }); }
  if (p === '/api/trace' && req.method === 'DELETE') { ws.app.rt.sqlTraceLog = []; return send(res, 200, { ok: true }); }
  // debugger: start a session (a console class or the unit tests), its state, commands
  // (classic programs: asynchronous, the classic engine's process answers)
  const later = r => { Promise.resolve(r).then(x => send(res, 200, x), e => sendError(res, e)); };
  if (p === '/api/debug' && req.method === 'POST') return later(ws.debugStart(json()));
  if (p === '/api/debug' && req.method === 'GET') return later(ws.debugState());
  if (p === '/api/debug/cmd' && req.method === 'POST') { const b = json(); return later(ws.debugCommand(b.cmd, b)); }
  // print forms: preview of a layout (the editor's text) with its sample data or a record of its data provider
  if (p === '/api/forms/preview' && req.method === 'POST') {
    const b = json();
    try {
      const store = formStore(ws.dir);
      // an Adobe XDP layout (the editor's XML, or the form object's layout): rendered natively with the data
      // provider's XML (SAP's shape) of the chosen record, else the first one
      const stored = b.name ? store.load(b.name) : null;
      if ((b.text !== undefined && /^\s*</.test(b.text)) || (b.text === undefined && stored?.xdp)) {
        const rt = ws.app.rt, fdp = stored?.dataProvider || b.dataProvider;
        let xml = null;
        if (fdp) { try { xml = rt.formXml(fdp, Object.entries(b.keys || {}).map(([name, value]) => ({ name, value: String(value) }))); } catch (e) { if (b.keys) throw e; } }
        const itf = !fdp ? formInterface(ws, stored) : null;
        if (itf) xml = itf.sample;
        const r = renderXdp(b.text !== undefined ? b.text : stored.xdp, xml, { locale: b.locale || stored?.locale, fontDirs: store.fontDirs(), assetDir: path.join(ws.dir, 'src') });
        res.writeHead(200, { 'Content-Type': 'application/pdf', 'X-Pages': String(r.pages), 'X-Fields': '0', 'X-Warnings': Buffer.from(JSON.stringify(r.warnings)).toString('base64'), 'Cache-Control': 'no-store' });
        return res.end(r.pdf);
      }
      const form = b.text !== undefined ? JSON.parse(b.text) : stored;
      if (!form) return send(res, 404, { error: { message: `Form ${b.name} not found` } });
      let data = form.sample || {};
      if (b.keys && form.dataProvider) {
        data = ws.app.rt.formRead(form.dataProvider, Object.entries(b.keys).map(([name, value]) => ({ name, value: String(value) })));
      }
      const rt = ws.app.rt;
      const r = renderForm(form, { sy: { datum: rt.s(rt.sy.datum), uzeit: rt.s(rt.sy.uzeit), uname: rt.s(rt.sy.uname || 'DEVELOPER') }, ...data }, { locale: b.locale || form.locale, assets: n => store.assets(n) });
      res.writeHead(200, { 'Content-Type': 'application/pdf', 'X-Pages': String(r.pages), 'X-Fields': String(r.fields.length), 'X-Warnings': Buffer.from(JSON.stringify(r.warnings)).toString('base64'), 'Cache-Control': 'no-store' });
      return res.end(r.pdf);
    } catch (e) { return send(res, 400, { error: { message: e.get_text ? e.get_text().$ret : e.message } }); }
  }
  // the visual designer: the layout as drawn (pages of drawing operations, where each item landed) and the data
  // (sample or a record of the data provider; else the first record) for the data view
  if (p === '/api/forms/design' && req.method === 'POST') {
    const b = json();
    try {
      const store = formStore(ws.dir);
      const form = JSON.parse(b.text);
      const rt = ws.app.rt;
      let data = form.sample || {}, source = 'sample';
      if (b.keys && form.dataProvider) { data = rt.formRead(form.dataProvider, Object.entries(b.keys).map(([name, value]) => ({ name, value: String(value) }))); source = 'record'; }
      else if (!form.sample && form.dataProvider) { try { data = rt.formRead(form.dataProvider, []); source = 'record'; } catch { data = {}; } }
      const r = renderForm(form, { sy: { datum: rt.s(rt.sy.datum), uzeit: rt.s(rt.sy.uzeit), uname: rt.s(rt.sy.uname || 'DEVELOPER') }, ...data }, { locale: b.locale || form.locale, assets: n => store.assets(n), design: true });
      const shape = v => (Array.isArray(v) ? v.slice(0, 2).map(shape) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, shape(x)])) : v);
      const assets = (() => { try { return fs.readdirSync(path.join(ws.dir, 'src')).filter(f => /\.(png|jpe?g|ttf)$/i.test(f)); } catch { return []; } })();
      return send(res, 200, { layout: r.layout, pages: r.pages, warnings: r.warnings, fields: r.fields, data: shape(data), source, assets });
    } catch (e) { return send(res, 400, { error: { message: e.get_text ? e.get_text().$ret : e.message } }); }
  }
  // the XDP designer: the layout rendered with the data (the PDF, base64) and where each template object landed;
  // schema: also the data provider's XSD (the Data View)
  // creating objects by hand (the New Object dialog) and the RAP business object generator (generate.js)
  if (p === '/api/generate/kinds' && req.method === 'GET') {
    const c = appContext(ws);
    return send(res, 200, { kinds: KINDS, tables: c.tables.map(t => ({ name: t.name, fields: t.fields.filter(f => !f.include).map(f => ({ name: f.name, key: f.key, type: f.type })) })), views: c.views, bdefs: c.bdefs, services: c.services,
      structures: c.structures.map(t => t.name), domains: [...c.ddic.domains.keys()], dataElements: [...c.ddic.dataElements.keys()], tableTypes: [...c.ddic.tableTypes.keys()],
      programs: c.programs, groups: [...new Set(c.functions.map(f => f.group))], interfaces: c.interfaces, flavor: c.flavor,
      messageClasses: fs.existsSync(path.join(ws.dir, 'src')) ? fs.readdirSync(path.join(ws.dir, 'src')).filter(f => f.endsWith('.msag.json')).map(f => f.split('.')[0].toUpperCase()) : [] });
  }
  if ((p === '/api/generate/object' || p === '/api/generate/rapbo') && req.method === 'POST') {
    const b = json();
    try {
      const c = appContext(ws);
      c.xdp = (srvd, title) => { const srv = ws.app.model.services.get(String(srvd).toLowerCase()); if (!srv) throw Object.assign(new Error(`Service ${srvd} is not active`), { status: 400 }); return generateXdp({ title, srv, model: ws.app.model }); };
      const r = p === '/api/generate/rapbo' ? rapBoFiles(c, b) : objectFiles(b.kind, b, c);
      const out = { files: Object.keys(r.files), open: r.open, notes: r.notes || [], preview: b.write ? undefined : r.files };
      if (!b.write) return send(res, 200, out);
      for (const [f, text] of Object.entries(r.files)) { const abs = ws.resolveFile(f); fs.mkdirSync(path.dirname(abs), { recursive: true }); fs.writeFileSync(abs, text); }
      ws.activate();
      const errs = ws.app.diagnostics.errors.filter(e => out.files.some(f => path.basename(f) === path.basename(String(e.file || ''))));
      out.errors = errs;
      // the Fiori elements app of a generated business object (its service is active now)
      if (p === '/api/generate/rapbo' && b.fiori !== false && !errs.length) {
        const srv = ws.app.model.services.get(String(r.service).toLowerCase());
        if (srv) { const app = generateFioriApp(ws.dir, { template: 'lrop', service: srv.name, entitySet: r.entitySet, name: `${String(r.entitySet).toLowerCase()}-fe`, title: r.entitySet, uiMetadata: ws.odata.uiMetadata(srv) }); out.app = app.path; out.appUrl = app.url; out.files.push(app.path); }
      }
      return send(res, 200, { ...out, summary: ws.summary() });
    } catch (e) { return send(res, e.status || 400, { error: { message: e.message } }); }
  }
  if (p === '/api/forms/xdp-design' && req.method === 'POST') {
    const b = json();
    try {
      const store = formStore(ws.dir);
      const stored = b.name ? (() => { try { return store.load(b.name); } catch { return null; } })() : null;
      const rt = ws.app.rt, fdp = b.dataProvider || stored?.dataProvider || null;
      let xml = null;
      if (fdp) { try { xml = rt.formXml(fdp, Object.entries(b.keys || {}).map(([name, value]) => ({ name, value: String(value) }))); } catch (e) { if (b.keys) throw e; } }
      // a classic form: its interface gives the Data View and the sample data of the preview
      const itf = !fdp ? formInterface(ws, stored) : null;
      if (itf) xml = itf.sample;
      const r = renderXdp(b.text, xml, { locale: b.locale || stored?.locale, fontDirs: store.fontDirs(), assetDir: path.join(ws.dir, 'src'), design: true });
      let xsd = null;
      if (b.schema && fdp) { try { xsd = rt.formXsd(fdp); } catch {} }
      if (b.schema && itf) xsd = interfaceXsd(itf.resolved);
      const services = b.schema ? [...ws.app.model.services.values()].map(s => s.name.toUpperCase()) : undefined;
      return send(res, 200, { pdf: r.pdf.toString('base64'), pages: r.pages, warnings: r.warnings, layout: r.layout, dataProvider: fdp, interface: itf?.name, signature: itf && b.schema ? signature(b.name, itf.resolved) : undefined, xsd, services });
    } catch (e) { return send(res, 400, { error: { message: e.get_text ? e.get_text().$ret : e.message } }); }
  }
  // the XML schema of a data provider (Download Schema: the data connection for Adobe LiveCycle Designer)
  if (p === '/api/forms/schema' && req.method === 'GET') {
    try {
      const itfName = url.searchParams.get('interface');
      const xsd = itfName ? interfaceXsd(formInterface(ws, { interface: itfName }).resolved) : ws.app.rt.formXsd(url.searchParams.get('srvd') || '');
      res.writeHead(200, { 'Content-Type': 'application/xml', 'Content-Disposition': `attachment; filename="${String(itfName || url.searchParams.get('srvd')).toUpperCase()}.xsd"` });
      return res.end(xsd);
    } catch (e) { return send(res, 400, { error: { message: e.get_text ? e.get_text().$ret : e.message } }); }
  }
  // the records a form's data provider offers (its leading entity: keys and a few fields), for the preview
  if (p === '/api/forms/records' && req.method === 'GET') {
    try {
      const form = formStore(ws.dir).load(url.searchParams.get('name') || '');
      if (!form?.dataProvider) return send(res, 200, { records: [] });
      const srv = ws.app.model.services.get(String(form.dataProvider).toLowerCase());
      const lead = String(srv?.ann?.objectmodel?.leadingentity?.name || '').toLowerCase();
      const root = srv?.exposes.find(e => e.entity === lead || e.alias.toLowerCase() === lead) || srv?.exposes[0];
      const ent = root && ws.app.model.entities.get(root.entity);
      if (!ent) return send(res, 200, { records: [] });
      const rows = ws.app.db.prepare(`SELECT * FROM "${ent.name}" LIMIT 50`).all();
      const label = ent.fields.find(f => !f.key && f.ti?.t === 'c')?.name;
      return send(res, 200, { entity: root.alias, records: rows.map(r => ({ keys: Object.fromEntries(ent.keys.map(k => [k.toUpperCase(), r[k]])), text: `${ent.keys.map(k => r[k]).join(' / ')}${label ? ` · ${r[label]}` : ''}` })) });
    } catch (e) { return send(res, 200, { records: [], error: e.message }); }
  }
  // runtime errors (ST22)
  if (p === '/api/dumps' && req.method === 'GET') return send(res, 200, listDumps(ws));
  if (p === '/api/dumps' && req.method === 'DELETE') { clearDumps(ws); return send(res, 200, { ok: true }); }
  if (p.startsWith('/api/dumps/')) { const d = getDump(ws, p.slice(11)); return d ? send(res, 200, d) : send(res, 404, { error: { message: 'No such runtime error' } }); }
  if (p === '/api/user') return userRoute(req, res, body, ws.opts.systemDir || ws.dir);
  if (p === '/api/classic') {
    if (req.method === 'POST') {
      if (!ws.classic.dbFile) return send(res, 400, { error: { message: 'Classic ABAP programs need the SQLite database (the default)' } });
      ws.classic.ensure().then(st => send(res, 200, st)).catch(e => sendError(res, e));
      return;
    }
    return send(res, 200, ws.classic.status());
  }
  if (p === '/api/events') return send(res, 200, ws.odata.rap.events(Number(url.searchParams.get('top') || 100)));
  if (p === '/api/changes') return send(res, 200, ws.odata.rap.changes({ entity: url.searchParams.get('entity'), objectId: url.searchParams.get('key'), top: Number(url.searchParams.get('top') || 200) }));
  if (p === '/api/activate' && req.method === 'POST') {
    ws.activate();
    // an app with classic programs: activated means converted and transpiled too (their errors in the result)
    if (ws.classic.dbFile && hasClassicSources(ws.dir) && classicAvailable()) { ws.classic.ensure().then(() => send(res, 200, ws.summary()), () => send(res, 200, ws.summary())); return; }
    return send(res, 200, ws.summary());
  }
  if (p === '/api/test' && req.method === 'POST') return send(res, 200, ws.runTests(url.searchParams.get('filter') || ''));
  if (p.startsWith('/api/run/') && req.method === 'POST') return send(res, 200, ws.runClass(decodeURIComponent(p.slice(9))));
  if (p.startsWith('/api/js/')) { const js = ws.generatedCode(decodeURIComponent(p.slice(8))); return js ? send(res, 200, js) : send(res, 404, 'not found'); }
  if (p.startsWith('/api/data/')) return send(res, 200, ws.tableData(decodeURIComponent(p.slice(10)), Number(url.searchParams.get('top') || 200)));
  if (p.startsWith('/api/source/')) {
    const rel = decodeURIComponent(p.slice(12));
    const f = ws.resolveFile(rel);
    if (req.method === 'PUT') {
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(f, body);
      return send(res, 200, { ok: true });
    }
    if (req.method === 'DELETE') { if (fs.existsSync(f)) fs.unlinkSync(f); return send(res, 200, { ok: true }); }
    if (!fs.existsSync(f)) return send(res, 404, 'not found');
    return send(res, 200, fs.readFileSync(f, 'utf8'));
  }
  if (p.startsWith('/api/vh/')) return send(res, 200, ws.odata.valueHelp(decodeURIComponent(p.slice(8)), url.searchParams.get('search'), Number(url.searchParams.get('top') || 50), req.headers));
  // custom freestyle apps: <workspace>/webapp/<app>/...
  if (p.startsWith('/apps/')) {
    const f = path.resolve(ws.dir, 'webapp', decodeURIComponent(p.slice(6)) || 'index.html');
    if (!f.startsWith(path.join(ws.dir, 'webapp') + path.sep) || !fs.existsSync(f)) return send(res, 404, 'not found');
    const file = fs.statSync(f).isDirectory() ? path.join(f, 'index.html') : f;
    // no-cache: the AI agent changes these files while the preview is open
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    return res.end(fs.readFileSync(file));
  }
  // Fiori-like UI runtime (index.html gets a <base> so it works under any prefix)
  if (p === '/' || p === '' || p === '/index.html') {
    const html = fs.readFileSync(path.join(UI_DIR, 'index.html'), 'utf8').replace('<head>', `<head>\n  <base href="${base}/">\n  <script>window.RAP_BASE = ${JSON.stringify(base)};</script>`);
    res.writeHead(200, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-cache' });
    return res.end(html);
  }
  const rel = p.replace(/^\/ui\//, '').replace(/^\//, '');
  const f = path.resolve(UI_DIR, rel);
  if (f.startsWith(UI_DIR + path.sep) && fs.existsSync(f) && fs.statSync(f).isFile()) {
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    return res.end(fs.readFileSync(f));
  }
  send(res, 404, { error: { message: `Not found: ${p}` } });
}
