// RAP Studio: hosts many RAP apps (one folder each) with chat-driven development through the local Claude Code CLI.
//   /                         studio UI (chat, preview, code, problems, data, console)
//   /studio/api/...           studio API (apps, chat, events, files, download)
//   /a/<app>/...              the app itself: Fiori-like UI, OData, workspace API (see server/server.js)
// Apps kept from the chat by GenUI5 (its "Keep as app") show on the home page too: GET /studio/api/chatapps asks the
// GenUI5 server (option genuiUrl, env RAP_GENUI5_URL, default http://127.0.0.1:4130/genui) for its list.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Workspace, routeWorkspace, send, sendError, MIME, UI_DIR, userRoute } from '../server/server.js';
import { saveAttachments, attachmentNote, attachmentMeta } from './attachments.js';
import { authStoreFor, authGate, requestGuard } from '../server/auth.js';
import { writeAbapGit } from './abapgit.js';
import { AgentSession } from './agent.js';
import { latestDelivery } from '../deliver/deliver.js';
import { Exercises } from './exercises.js';
import { runAtc } from '../check/atc.js';
import { cleanerAvailable, cleanSource } from '../check/cleaner.js';

// Content-Security-Policy of the studio page: scripts from this origin and the code editor / PDF viewer
// (cdn.jsdelivr.net, pinned versions); images only from this origin, data: and blob:; requests to this origin only.
// (The Fiori previews are separate pages in frames, served by the app with their own headers.)
export const CSP_MONACO = 'https://cdn.jsdelivr.net/npm/monaco-editor@0.52.2/';
export const CSP_PDFJS = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/';
export function studioCsp() {
  // only the exact package versions the studio loads (src/ui/studio/studio.js MONACO, xdp-designer.js PDFJS)
  const CDN = `${CSP_MONACO} ${CSP_PDFJS}`;
  return [
    "default-src 'self'",
    `script-src 'self' ${CDN}`,
    `style-src 'self' 'unsafe-inline' ${CDN}`,
    `font-src 'self' data: ${CDN}`,
    "img-src 'self' data: blob:",
    "connect-src 'self'",
    `worker-src 'self' blob: data:`,
    "frame-src 'self' blob: http://localhost:* http://127.0.0.1:*",   // the classic engine serves its GUI on its own local port
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'self'",
  ].join('; ');
}

// shown next to the name in the studio header
const VERSION = JSON.parse(fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version;
import { generateFioriApp, TEMPLATES } from './fiori.js';
import { SYSTEM_MARKER, STANDARD_APP, STANDARD_DIR, systemCatalog, describeCatalog } from '../rap/catalog.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const TEMPLATE = path.join(HERE, 'template', 'CLAUDE.md');
const NAME_RE = /^[a-z][a-z0-9-]{1,40}$/;

export class Studio {
  constructor(appsDir, { port = 4004, model, host = '127.0.0.1', genuiUrl = process.env.RAP_GENUI5_URL || 'http://127.0.0.1:4130/genui' } = {}) {
    this.host = host;
    this.genuiUrl = String(genuiUrl).replace(/\/+$/, '');
    this.dir = path.resolve(appsDir);
    this.port = port;
    this.model = model;
    fs.mkdirSync(this.dir, { recursive: true });
    // all apps in this folder form one system: they can use each other's tables and views (src/rap/catalog.js)
    const marker = path.join(this.dir, SYSTEM_MARKER);
    if (!fs.existsSync(marker)) fs.writeFileSync(marker, JSON.stringify({ system: 'RAP Studio', note: 'apps in this folder share tables and views' }, null, 1) + '\n');
    this.workspaces = new Map();
    this.agents = new Map();
    this.streams = new Map(); // app -> Set(res)
    this.exercises = new Exercises(this.dir);
  }

  // the apps GenUI5 kept from the chat: { available, launchpad, apps: [{id, title, created, url}] }; GenUI5 not
  // running (or answering something else) is no error, the section just stays away
  async chatApps() {
    try {
      const r = await fetch(`${this.genuiUrl}/apps`, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(1500) });
      if (!r.ok) return { available: false, apps: [] };
      const d = await r.json();
      const launchpad = `${this.genuiUrl}/apps/`;
      const apps = (Array.isArray(d?.apps) ? d.apps : [])
        .filter(a => a && /^[a-z0-9][a-z0-9-]{0,47}$/.test(String(a.id)) && typeof a.title === 'string' && a.title.length <= 120)
        .slice(0, 50)
        .map(a => ({ id: a.id, title: a.title, created: typeof a.created === 'string' ? a.created : null, url: `${launchpad}${a.id}/` }));
      return { available: true, launchpad, apps };
    } catch { return { available: false, apps: [] }; }
  }

  apps() {
    return fs.readdirSync(this.dir, { withFileTypes: true })
      .filter(d => d.isDirectory() && !d.name.startsWith('.') && NAME_RE.test(d.name))
      .map(d => {
        // .app.json next to src/ (shipped with the app: title, description) under the local .rap/app.json
        const meta = { ...(readJson(path.join(this.dir, d.name, '.app.json')) || {}), ...(readJson(path.join(this.dir, d.name, '.rap', 'app.json')) || {}) };
        const stat = fs.statSync(path.join(this.dir, d.name));
        return { name: d.name, title: meta.title || d.name, prompt: meta.prompt || '', created: meta.created || stat.birthtime, archived: meta.archived || undefined, running: !!this.agents.get(d.name)?.running, ...contents(path.join(this.dir, d.name)) };
      })
      .sort((a, b) => String(b.created).localeCompare(String(a.created)))
      // the SAP standard layer: browsable like an app, read-only
      .concat([{ name: STANDARD_APP, title: 'SAP S/4HANA Standard', prompt: 'Customers, suppliers, products, plants, currencies and more: SAP\'s tables and released CDS views with demo data, ready for every app.', created: '', running: false, standard: true, ...contents(STANDARD_DIR) }]);
  }

  // archive: the app leaves "Your apps" for the Archived section; files, data and its tables in the system stay.
  // Its workspace closes (watcher, jobs, classic engine) and opens again when someone opens the app.
  archive(name, archived) {
    const dir = this.appDir(name);
    if (name === STANDARD_APP) throw Object.assign(new Error('The SAP standard layer cannot be archived'), { status: 403 });
    if (this.agents.get(name)?.running) throw Object.assign(new Error('The agent is working on this app; stop it first'), { status: 409 });
    const file = path.join(dir, '.rap', 'app.json'), meta = readJson(file) || { title: readJson(path.join(dir, '.app.json'))?.title || name };
    if (archived) meta.archived = new Date().toISOString(); else delete meta.archived;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(meta, null, 1));
    if (archived) this.closeApp(name);
    return { name, archived: meta.archived || null };
  }

  // delete for good: only an archived app, so nothing disappears with one click
  remove(name) {
    const dir = this.appDir(name);
    if (name === STANDARD_APP) throw Object.assign(new Error('The SAP standard layer cannot be deleted'), { status: 403 });
    if (!readJson(path.join(dir, '.rap', 'app.json'))?.archived) throw Object.assign(new Error('Archive the app before you delete it'), { status: 409 });
    if (this.agents.get(name)?.running) throw Object.assign(new Error('The agent is working on this app; stop it first'), { status: 409 });
    this.closeApp(name);
    fs.rmSync(dir, { recursive: true, force: true });
    return { name, deleted: true };
  }

  closeApp(name) {
    this.workspaces.get(name)?.close();
    this.workspaces.delete(name);
    this.agents.delete(name);
    for (const res of this.streams.get(name) || []) { try { res.end(); } catch {} }
    this.streams.delete(name);
  }

  appDir(name) {
    if (name === STANDARD_APP) return STANDARD_DIR;
    if (!NAME_RE.test(name)) throw Object.assign(new Error(`Invalid app name ${name}`), { status: 400 });
    const d = path.join(this.dir, name);
    if (!fs.existsSync(d)) throw Object.assign(new Error(`App ${name} not found`), { status: 404 });
    return d;
  }

  // jobs: start the app's job scheduler (default). A plain GET/HEAD of an app page or resource (/a/<app>/…) opens the
  // workspace without it; the studio's own API (administrators) or a change request (non-GET) starts it.
  workspace(name, { jobs = true } = {}) {
    if (this.workspaces.get(name)?.removed) this.workspaces.delete(name);
    const open = this.workspaces.get(name);
    if (open) { if (jobs && !open.jobsStarted) { open.startJobScheduler(); open.jobsStarted = true; } return open; }
    if (!fs.existsSync(this.appDir(name))) throw Object.assign(new Error(`App ${name} does not exist`), { status: 404 });
    if (!this.workspaces.has(name)) {
      const ws = new Workspace(this.appDir(name), { systemDir: this.dir });
      ws.watch(true);
      if (jobs) { ws.startJobScheduler(); ws.jobsStarted = true; }   // application jobs of the app run while the studio runs
      ws.listeners.add(w => this.broadcast(name, { type: 'activation', version: w.version, errors: w.app.diagnostics.errors.length, warnings: w.app.diagnostics.warnings.length }));
      ws.listeners.add(() => this.reactivateUsers(name));
      this.workspaces.set(name, ws);
      // apps whose tables this app reads must have their database: open them once, then activate again
      const owners = new Set([...(ws.app.model.externals?.values() || [])].map(x => x.app));
      let opened = false;
      for (const o of owners) if (!this.workspaces.has(o) && fs.existsSync(this.appDir(o))) { this.workspace(o, { jobs }); opened = true; }
      if (opened) ws.activate();
    }
    return this.workspaces.get(name);
  }

  // the SAP standard layer for the studio's catalog: business areas, objects with their fields, tables and row counts
  standardCatalog() {
    const ws = this.workspace(STANDARD_APP);
    const m = ws.app.model, db = ws.app.db;
    const cat = readJson(path.join(STANDARD_DIR, 'catalog.json')) || { areas: [] };
    const type = ti => ti ? `${ti.t}${ti.len ? `(${ti.len}${ti.dec ? `,${ti.dec}` : ''})` : ''}` : '';
    const count = name => { try { return db.prepare(`SELECT COUNT(*) AS n FROM "${name.toLowerCase()}"`).get().n; } catch { return null; } };
    let objects = 0, rows = 0;
    for (const a of cat.areas) {
      for (const o of a.objects) {
        const ent = m.entities.get(o.view.toLowerCase());
        const table = m.tables.get(o.table);
        o.fields = (ent?.fields || []).map(f => ({ name: f.label || f.name, key: !!ent.keys?.includes(f.name), type: type(f.ti) }));
        o.tableFields = (table?.fields || []).filter(f => f.ti?.t !== 'clnt').map(f => f.name);
        o.rows = count(o.view);
        objects++; rows += o.rows || 0;
      }
    }
    return { ...cat, totals: { tables: m.tables.size, views: [...m.entities.values()].filter(e => e.kind !== 'table').length, objects, rows } };
  }
  standardRows(view, top = 25) {
    const ws = this.workspace(STANDARD_APP);
    const v = String(view || '').toLowerCase();
    // released views and the compatibility views (MKPF, BSID …); not the tables
    if (!/^[a-z]\w*$/.test(v) || !ws.app.model.entities.has(v) || ws.app.model.entities.get(v).kind === 'table') throw Object.assign(new Error(`Unknown view ${view}`), { status: 404 });
    const ent = ws.app.model.entities.get(v);
    const rows = ws.app.db.prepare(`SELECT * FROM "${v}" LIMIT ${Math.min(Math.max(top, 1), 200)}`).all();
    // the view's own field names (SQLite returns them in lower case)
    const names = ent.fields.map(f => f.label || f.name);
    return { view: ent.label || view, columns: names, rows: rows.map(r => Object.fromEntries(names.map(n => [n, r[n.toLowerCase()] ?? r[n]]))) };
  }

  // what other apps already define, so a new app reuses master data instead of copying it
  reuseHint(name) {
    const cat = systemCatalog(this.dir, this.appDir(name), { standard: false });   // the standard layer is described in CLAUDE.md
    for (const [n, x] of cat) {
      const d = x.def;
      if (/^zc_/i.test(n) || (d.fields || []).some(f => f.include) || d.ann?.analytics || d.ann?.aggregation) cat.delete(n);   // projections, draft and analytical objects
    }
    const rows = describeCatalog(cat);
    if (!rows.length) return '';
    return ` Other apps in this system already define these tables and views. Reuse them where they fit (see "Reuse what exists" in CLAUDE.md) instead of creating your own copies:\n${rows.slice(0, 40).join('\n')}${rows.length > 40 ? `\n(${rows.length - 40} more: run the catalog command)` : ''}\n`;
  }

  // apps that use tables/views of `name` see its changes (one level, so apps using each other don't loop)
  reactivateUsers(name) {
    if (this.cascading) return;
    this.cascading = true;
    try {
      for (const [other, ws] of this.workspaces) {
        if (other === name || ws.removed) continue;
        if ([...(ws.app?.model?.externals?.values() || [])].some(x => x.app === name)) ws.activate();
      }
    } finally { this.cascading = false; }
  }

  // the agent's instructions of an app (CLAUDE.md, gitignored), written from the template: at creation and before
  // every chat run, so apps always get the platform's current instructions
  writeInstructions(name) {
    const dir = this.appDir(name);
    if (!fs.existsSync(dir)) return;
    fs.writeFileSync(path.join(dir, 'CLAUDE.md'), fs.readFileSync(TEMPLATE, 'utf8')
      .replaceAll('{{APP}}', name)
      .replaceAll('{{RAP}}', path.join(ROOT, 'bin', 'rap.js'))
      .replaceAll('{{PORT}}', String(this.port))
      .replaceAll('{{EXAMPLE}}', path.join(ROOT, 'examples', 'travel'))
      .replaceAll('{{CLASSIC}}', path.join(ROOT, 'examples', 'classic'))
      .replaceAll('{{FORMS}}', path.join(ROOT, 'examples', 'forms'))
      .replaceAll('{{KNOWLEDGE}}', path.join(ROOT, 'knowledge'))
      .replaceAll('{{ORDERS}}', path.join(ROOT, 'examples', 'orders'))
      .replaceAll('{{DOCS}}', path.join(ROOT, 'docs'))
      .replaceAll('{{ROOT}}', ROOT));
  }
  agent(name) {
    if (!this.agents.has(name)) {
      const a = new AgentSession(this.appDir(name), {
        rapBin: path.join(ROOT, 'bin', 'rap.js'),
        port: this.port,
        // reference folders of the builder agent; docs/ and test/fixtures exist in a checkout, not in the npm package
        extraDirs: [this.dir, path.join(ROOT, 'examples'), path.join(ROOT, 'docs'), path.join(ROOT, 'knowledge'), path.join(ROOT, 'test', 'fixtures')].filter(d => fs.existsSync(d)),
        model: this.model,
      });
      a.subscribe(ev => { this.broadcast(name, ev); if (ev.type === 'end') this.afterRun(name, ev.run); });
      this.agents.set(name, a);
    }
    return this.agents.get(name);
  }

  // after the agent changed the app: the delivery documents (technical specification, QA test report, ATC report)
  // in the chat. The agent writes them with rap deliver; when it did not, the studio does (from the sources, or from
  // .rap/delivery.json when the agent described this change).
  afterRun(name, run) {
    if (run?.status !== 'done' || this.delivering?.has(name)) return;
    let dir; try { dir = this.appDir(name); } catch { return; }
    const since = Date.parse(run.at) || 0;
    const latest = latestDelivery(dir);
    const post = (m, auto) => { const a = this.agent(name); a.push({ role: 'deliverables', at: new Date().toISOString(), auto, status: 'done', ...summaryOf(m) }); a.save(); };
    if (latest && Date.parse(latest.created) >= since) return post(latest, false);
    if (!changedSince(dir, since)) return;
    const described = (() => { try { return fs.statSync(path.join(dir, '.rap', 'delivery.json')).mtimeMs >= since; } catch { return false; } })();
    const item = this.agent(name).push({ role: 'deliverables', at: new Date().toISOString(), auto: true, status: 'running' });
    (this.delivering ||= new Set()).add(name);
    const args = [path.join(ROOT, 'bin', 'rap.js'), 'deliver', dir, ...(described ? [] : ['--no-description'])];
    const p = spawn(process.execPath, args, { cwd: dir, env: { ...process.env, RAP_PORT: String(this.port), RAP_APP: name }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    p.stdout.on('data', c => { out += c; }); p.stderr.on('data', c => { out += c; });
    p.on('close', () => {
      this.delivering.delete(name);
      const m = latestDelivery(dir);
      const ok = m && Date.parse(m.created) >= since;
      Object.assign(item, ok ? { status: 'done', ...summaryOf(m) } : { status: 'error', error: out.trim().split('\n').slice(-4).join('\n') || 'The documents could not be written' });
      const a = this.agent(name);
      a.emit({ type: 'update', id: a.state.items.indexOf(item), item });
      a.save();
    });
  }

  broadcast(name, ev) {
    for (const res of this.streams.get(name) || []) res.write(`data: ${JSON.stringify(ev)}\n\n`);
  }

  create({ prompt = '', name, ui, attachments, title: appTitle, flavor }) {
    let base = (name || slug(prompt) || 'app').toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'app';
    if (!/^[a-z]/.test(base)) base = 'app-' + base;
    let n = base, i = 2;
    while (fs.existsSync(path.join(this.dir, n))) n = `${base}-${i++}`;
    const dir = path.join(this.dir, n);
    fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'data'), { recursive: true });
    fs.mkdirSync(path.join(dir, '.rap'), { recursive: true });
    this.writeInstructions(n);
    fs.writeFileSync(path.join(dir, '.gitignore'), '.rap/\n');
    // a blank app (built by hand in the Code tab): its title and whether it is a RAP or a classic app (defaults of the
    // New Object dialog: UUID keys and administrative fields only for RAP)
    fs.writeFileSync(path.join(dir, '.rap', 'app.json'), JSON.stringify({ title: String(appTitle || '').trim() || title(prompt) || n, prompt, ui: ui || undefined, flavor: ['rap', 'classic'].includes(flavor) ? flavor : undefined, created: new Date().toISOString() }, null, 1));
    if (prompt.trim()) {
      const brief = ui?.kind === 'forms'
        ? `Build it as described in "Print forms (SAP Adobe forms)" in CLAUDE.md and ${path.join(ROOT, 'knowledge', 'forms.md')}: the data model (tables with realistic seed data, CDS views of the root and its children with associations), the form data provider (a service definition with @ObjectModel.leadingEntity), the layout src/z<form>.form.json with sample data, and an ABAP class that renders, prints (and, if asked, reads back or signs) the form with the SAP APIs.${this.reuseHint(n)} Verify with the check command until there are 0 errors, run rap form check until it reports no findings, render the form with the rap form command for a real record and read the text of its pages, run the ABAP class, and delete the test prints you made.`
        : ui?.kind === 'classic'
        ? `Build it as described in "Classic ABAP programs" in CLAUDE.md: the database tables it needs (or reuse existing ones) with realistic seed data, and the classic programs.${this.reuseHint(n)} Verify with the check command until there are 0 errors, compile the programs with the gui --build-only command, then run every program, transaction, job and form you built with the rap program / transaction / job / form commands and check the output.`
        : `Build it completely as described in CLAUDE.md: data model, behavior, projections, UI annotations, service and realistic seed data.${this.reuseHint(n)} Verify with the check command until there are 0 errors and smoke-test the OData service with the rap odata command, deleting any test records you create.`;
      const files = saveAttachments(dir, n, attachments);
      this.agent(n).run(`${prompt.trim()}${attachmentNote(files)}\n\n(This is a new, empty RAP Studio app "${n}". ${brief}${uiInstruction(ui)} Finish with a short summary.)`, { display: prompt.trim() + uiLabel(ui), attachments: attachmentMeta(files) });
    }
    return { name: n };
  }

  files(name) {
    const dir = this.appDir(name);
    const out = [];
    const walk = (d) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        if (e.name === '.rap' || e.name === 'node_modules' || e.name === '.git' || e.name === '.DS_Store') continue;
        const p = path.join(d, e.name);
        if (e.isDirectory()) walk(p); else out.push(path.relative(dir, p));
      }
    };
    walk(dir);
    // the workbench shows the app's sources and its documents (docs: Word and PDF), not the agent's instruction file
    // or other project files
    return out.filter(f => /^(src|webapp|data)\//.test(f) || /^docs\/.+\.(pdf|docx)$/.test(f)).sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
  }

  download(name, res) {
    const dir = this.appDir(name);
    res.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="${name}.zip"` });
    const z = spawn('zip', ['-r', '-q', '-', '.', '-x', '.rap/*', '-x', '*.DS_Store', '-x', 'CLAUDE.md'], { cwd: dir });
    z.stdout.pipe(res);
    z.on('error', () => res.end());
  }

  // the app as an abapGit repository (zip), ready to pull into an SAP system
  downloadAbapGit(name, res) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rap-abapgit-'));
    writeAbapGit(this.appDir(name), tmp);
    res.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="${name}-abapgit.zip"` });
    const z = spawn('zip', ['-r', '-q', '-', '.'], { cwd: tmp });
    z.stdout.pipe(res);
    const done = () => fs.rmSync(tmp, { recursive: true, force: true });
    z.on('close', done);
    z.on('error', () => { done(); res.end(); });
  }

  // ------------------------------------------------------------------ http
  listen() {
    const server = http.createServer((req, res) => {
      const chunks = [];
      req.on('data', c => chunks.push(c));
      req.on('end', () => {
        req.rawBody = Buffer.concat(chunks);
        const body = req.rawBody.toString();
        try {
          if (requestGuard(req, res, { host: this.host })) return;
          const auth = authStoreFor(this.dir);
          if (authGate(auth, req, res, body)) return;
          // with users configured, the studio itself (building apps, sources) is for administrators only
          const p = new URL(req.url, 'http://localhost').pathname;
          if (auth.enabled && !p.startsWith('/a/') && !auth.user(req.headers['x-rap-user'])?.admin) {
            // a browser gets a page: the apps this user can open, and the logoff
            if (req.method === 'GET' && /text\/html/.test(req.headers.accept || '')) return this.endUserPage(res, req.headers['x-rap-user']);
            return send(res, 403, { error: { message: `User ${req.headers['x-rap-user']} is not an administrator of this studio` } });
          }
          this.route(req, res, body);
        }
        catch (e) { sendError(res, e); }
      });
    });
    server.listen(this.port, this.host);
    this.server = server;
    this.installShutdown();
    return server;
  }

  // the start page of a logged-on user who is no administrator: the apps (their UIs), the logoff
  endUserPage(res, user) {
    const esc = t => String(t ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
    const apps = this.apps().filter(a => a.name !== STANDARD_APP && !a.archived);
    const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>RAP Studio</title>
<style>:root{color-scheme:light dark;--bg:#f6f7f9;--panel:#fff;--text:#1c2733;--muted:#5d6b7a;--border:#e1e4e8;--brand:#0a6ed1}@media (prefers-color-scheme:dark){:root{--bg:#0e1116;--panel:#161b22;--text:#e6edf3;--muted:#9aa7b4;--border:#2a313b;--brand:#4ea1f3}}
body{margin:0;font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;background:var(--bg);color:var(--text)}main{max-width:760px;margin:0 auto;padding:40px 16px}
header{display:flex;justify-content:space-between;align-items:center;margin-bottom:24px}h1{font-size:22px;margin:0}a{color:var(--brand)}
ul{list-style:none;padding:0;display:grid;gap:10px}li a{display:block;padding:14px 16px;background:var(--panel);border:1px solid var(--border);border-radius:10px;text-decoration:none;color:var(--text)}
li a:hover{border-color:var(--brand)}li small{display:block;color:var(--muted)}p.note{color:var(--muted)}</style></head><body><main>
<header><h1>Apps</h1><span>${esc(user)} · <a href="/logout">Log off</a></span></header>
<p class="note">You are logged on as ${esc(user)}. Building and changing apps is for administrators; you can use the apps.</p>
<ul>${apps.map(a => `<li><a href="/a/${encodeURIComponent(a.name)}/"><strong>${esc(a.title)}</strong><small>${esc(a.prompt || a.name)}</small></a></li>`).join('') || '<li class="note">No apps yet.</li>'}</ul>
</main></body></html>`;
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'self'", 'X-Content-Type-Options': 'nosniff' });
    res.end(html);
  }

  // Ctrl+C / SIGTERM (or a supervisor stopping the studio): close every workspace (job scheduler, watchers,
  // databases) and stop the builder agents, then exit, so no agent process outlives the studio
  close({ hard = false } = {}) {
    for (const [name, ws] of this.workspaces) {
      try { ws.close(); } catch (e) { console.error(`[rap] ${name} did not close cleanly: ${e.message}`); }
    }
    this.workspaces.clear();
    for (const a of this.agents.values()) { try { a.stop(); } catch {} }
    for (const set of this.streams.values()) for (const res of set) { try { res.end(); } catch {} }
    try { this.server?.close(); this.server?.closeAllConnections?.(); } catch {}
  }
  installShutdown() {
    if (Studio.shutdownInstalled) return;
    Studio.shutdownInstalled = true;
    let stopping = false;
    const stop = sig => {
      if (stopping) process.exit(130);   // a second Ctrl+C: leave at once
      stopping = true;
      console.log(`[rap] ${sig}: stopping RAP Studio`);
      try { this.close({ hard: true }); } catch (e) { console.error(e); }
      setTimeout(() => process.exit(0), 200).unref?.();
    };
    process.on('SIGINT', () => stop('SIGINT'));
    process.on('SIGTERM', () => stop('SIGTERM'));
  }

  route(req, res, body) {
    const url = new URL(req.url, 'http://localhost');
    const p = decodeURIComponent(url.pathname);
    const json = () => (body ? JSON.parse(body) : {});

    // the apps themselves
    const am = /^\/a\/([^/]+)(\/.*)?$/.exec(p);
    if (am) {
      if (!am[2]) { res.writeHead(302, { Location: `/a/${am[1]}/` }); return res.end(); }
      const ws = this.workspace(am[1], { jobs: req.method !== 'GET' && req.method !== 'HEAD' });
      return routeWorkspace(ws, req, res, body, am[2] === '/' ? '/' : url.pathname.slice(`/a/${am[1]}`.length), `/a/${am[1]}`);
    }

    // studio API
    if (p === '/studio/api/apps' && req.method === 'GET') return send(res, 200, { apps: this.apps(), port: this.port });
    if (p === '/studio/api/standard' && req.method === 'GET') return send(res, 200, this.standardCatalog());
    if (p === '/studio/api/chatapps' && req.method === 'GET') { this.chatApps().then(r => send(res, 200, r), e => sendError(res, e)); return; }
    if (p === '/studio/api/standard/rows' && req.method === 'GET') return send(res, 200, this.standardRows(url.searchParams.get('view'), Number(url.searchParams.get('top') || 25)));
    if (p === '/studio/api/user') return userRoute(req, res, body, this.dir);
    if (p === '/studio/api/apps' && req.method === 'POST') return send(res, 201, this.create(json()));
    // ABAP exercises (exercism's ABAP track): list, the learner's files, tests, checks, reference solution
    if (p === '/studio/api/exercises' && req.method === 'GET') return send(res, 200, { ...this.exercises.list(), cleaner: !!cleanerAvailable() });
    const ex = /^\/studio\/api\/exercises\/([a-z0-9-]+)(?:\/(.+))?$/.exec(p);
    if (ex) {
      const [, slug, sub] = ex, X = this.exercises;
      if (!sub && req.method === 'GET') return send(res, 200, X.open(slug));
      if (sub?.startsWith('files/') && req.method === 'PUT') { X.save(slug, sub.slice(6), body); return send(res, 200, { ok: true }); }
      if (sub === 'test' && req.method === 'POST') {
        const b = json();
        if (b.name) X.save(slug, b.name, b.text);
        X.test(slug).then(r => send(res, 200, r)).catch(e => sendError(res, e));
        return;
      }
      if (sub === 'check' && req.method === 'POST') {
        const b = json();
        const rel = `src/${b.name}`;
        return send(res, 200, runAtc(path.dirname(X.ensure(slug)), { file: rel, overrides: { [rel]: String(b.text ?? '') } }));
      }
      if (sub === 'clean' && req.method === 'POST') return send(res, 200, cleanSource(String(json().text ?? '')));
      if (sub === 'reset' && req.method === 'POST') return send(res, 200, X.reset(slug));
      if (sub === 'solution' && req.method === 'GET') return send(res, 200, X.example(slug));
    }
    const del = /^\/studio\/api\/apps\/([^/]+)$/.exec(p);
    if (del && req.method === 'DELETE') return send(res, 200, this.remove(del[1]));
    const m = /^\/studio\/api\/apps\/([^/]+)\/(.+)$/.exec(p);
    if (m) {
      const [, name, sub] = m;
      if (sub === 'archive' && req.method === 'POST') return send(res, 200, this.archive(name, json().archived !== false));
      if (sub === 'chat' && req.method === 'GET') return send(res, 200, this.agent(name).history());
      if (sub === 'chat' && req.method === 'POST' && name === STANDARD_APP) return send(res, 403, { error: { message: 'The SAP standard layer is read-only. Build your app in its own app and use these tables and views there.' } });
      if (sub === 'chat' && req.method === 'POST') {
        this.workspace(name); this.writeInstructions(name);
        const b = json();
        if (this.agent(name).running) return send(res, 409, { error: { message: 'The agent is already working on this app' } });
        const files = saveAttachments(this.appDir(name), name, b.attachments);
        this.agent(name).run(String(b.message) + attachmentNote(files) + (b.ui ? `\n\n(${uiInstruction(b.ui).trim()})` : ''), { display: String(b.message) + uiLabel(b.ui), attachments: attachmentMeta(files) });
        return send(res, 202, { ok: true });
      }
      // the files attached to chat messages (thumbnails, downloads)
      if (sub?.startsWith('attachments/') && req.method === 'GET') {
        const f = path.join(this.appDir(name), '.rap', 'attachments', path.basename(sub.slice(12)));
        if (!fs.existsSync(f)) return send(res, 404, { error: { message: 'No such attachment' } });
        const ext = path.extname(f).toLowerCase();
        const type = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp', '.pdf': 'application/pdf', '.txt': 'text/plain; charset=utf-8' }[ext] || 'application/octet-stream';
        res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'private, max-age=86400', ...(type === 'application/octet-stream' ? { 'Content-Disposition': `attachment; filename="${path.basename(f).replace(/^\d+-\d+-/, '')}"` } : {}) });
        return res.end(fs.readFileSync(f));
      }
      if (sub === 'chat/stop' && req.method === 'POST') return send(res, 200, { stopped: this.agent(name).stop() });
      if (sub === 'files') return send(res, 200, { files: this.files(name) });
      if (sub === 'fiori' && req.method === 'GET') {
        const ws = this.workspace(name);
        return send(res, 200, { templates: TEMPLATES, services: [...ws.app.model.services.values()].map(sv => ({ name: sv.name, label: sv.label, entitySets: sv.exposes.map(e => e.alias) })) });
      }
      if (sub === 'fiori' && req.method === 'POST') {
        const ws = this.workspace(name);
        const b = json();
        const srv = ws.app.model.services.get(String(b.service).toLowerCase());
        if (!srv) throw Object.assign(new Error(`Service ${b.service} not found`), { status: 400 });
        return send(res, 201, generateFioriApp(ws.dir, { template: b.template, service: srv.name, entitySet: b.entitySet, name: b.name, title: b.title, uiMetadata: ws.odata.uiMetadata(srv) }));
      }
      // the delivery documents (docs/<folder>/<file>)
      const dm = /^docs\/([\w.-]+)\/([\w.-]+\.(?:docx|pdf))$/.exec(sub || '');
      if (dm && req.method === 'GET') {
        const f = path.join(this.appDir(name), 'docs', dm[1], dm[2]);
        if (!fs.existsSync(f)) return send(res, 404, { error: { message: 'No such document' } });
        const pdf = f.endsWith('.pdf');
        res.writeHead(200, { 'Content-Type': pdf ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'Content-Disposition': `${pdf ? 'inline' : 'attachment'}; filename="${dm[2]}"`, 'Cache-Control': 'no-cache' });
        return res.end(fs.readFileSync(f));
      }
      if (sub === 'download') return this.download(name, res);
      if (sub === 'abapgit') return this.downloadAbapGit(name, res);
      if (sub === 'events') {
        this.workspace(name);
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
        res.write(`data: ${JSON.stringify({ type: 'hello', running: this.agent(name).running })}\n\n`);
        if (!this.streams.has(name)) this.streams.set(name, new Set());
        this.streams.get(name).add(res);
        const ping = setInterval(() => res.write(`data: ${JSON.stringify({ type: 'ping' })}\n\n`), 15000);   // heartbeat the page watches
        req.on('close', () => { clearInterval(ping); this.streams.get(name)?.delete(res); });
        return;
      }
    }

    // studio UI
    if (p === '/' || p === '/index.html') {
      const html = fs.readFileSync(path.join(UI_DIR, 'studio', 'index.html'), 'utf8').replaceAll('{{VERSION}}', VERSION);
      res.writeHead(200, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-cache', 'Content-Security-Policy': studioCsp(), 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin' });
      return res.end(html);
    }
    if (p.startsWith('/studio/')) {
      const f = path.resolve(UI_DIR, 'studio', p.slice(8));
      if (f.startsWith(path.join(UI_DIR, 'studio') + path.sep) && fs.existsSync(f)) return file(res, f);
    }
    send(res, 404, { error: { message: `Not found: ${p}` } });
  }
}

function file(res, f) {
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  res.end(fs.readFileSync(f));
}
// what an app holds, for its card: counts per kind of object and when its sources last changed
function contents(dir) {
  const out = { tables: 0, views: 0, services: 0, classes: 0, programs: 0, transactions: 0, forms: 0, uiApps: 0, changed: 0 };
  const src = path.join(dir, 'src');
  try {
    for (const f of fs.readdirSync(src)) {
      const b = f.toLowerCase();
      if (/\.tabl\./.test(b)) out.tables++;
      else if (/\.ddls\./.test(b)) out.views++;
      else if (/\.srvd\./.test(b)) out.services++;
      else if (/\.clas\.abap$/.test(b)) out.classes++;
      else if (/\.prog\.abap$/.test(b)) out.programs++;
      else if (/\.tran\.xml$/.test(b)) out.transactions++;
      else if (/\.form\.json$/.test(b)) out.forms++;
      out.changed = Math.max(out.changed, fs.statSync(path.join(src, f)).mtimeMs);
    }
  } catch {}
  try { out.uiApps = fs.readdirSync(path.join(dir, 'webapp'), { withFileTypes: true }).filter(e => e.isDirectory()).length; } catch {}
  out.kind = out.programs || out.forms ? (out.services ? 'both' : 'classic') : 'rap';
  return out;
}
function readJson(f) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } }
const STOP = new Set(['a', 'an', 'the', 'app', 'application', 'build', 'create', 'make', 'me', 'for', 'to', 'with', 'and', 'of', 'that', 'which', 'i', 'want', 'need', 'please', 'simple', 'rap', 'based', 'new', 'manage', 'managing', 'where', 'can', 'should', 'be', 'able', 'my', 'our', 'in', 'on']);
// the user's UI choice (asked by the chat when the prompt does not say which UI): { kind: 'fiori' | 'freestyle' | 'classic' | 'forms', template }
export function uiInstruction(ui) {
  if (!ui?.kind) return '';
  if (ui.kind === 'forms') return ` Output: the user wants a print form (SAP Adobe form): see "Print forms (SAP Adobe forms)" in CLAUDE.md and ${path.join(ROOT, 'knowledge', 'forms.md')}. Build the data provider (CDS views + a service definition with @ObjectModel.leadingEntity), the layout src/z<form>.form.json and the ABAP that outputs it; check it with \`node ${path.join(ROOT, 'bin', 'rap.js')} form check\` and render it with \`node ${path.join(ROOT, 'bin', 'rap.js')} form <FORM> <KEY>=<value>\`. No Fiori app unless the user asks for one.`;
  if (ui.kind === 'classic') return ` UI: the user wants classic ABAP programs (see "Classic ABAP programs"): reports as \`src/z<name>.prog.abap\` with \`.prog.xml\` (title and selection texts), a selection screen for the filters the user mentions and an ALV list (\`cl_salv_table\`) or WRITE list; module pools when the user asks for screens or a transaction. Compile them with \`node ${path.join(ROOT, 'bin', 'rap.js')} gui . --build-only\` until there are no errors, then run them with the program / transaction commands (see "Run and test classic programs"). No Fiori app unless the user asks for one.`;
  if (ui.kind === 'freestyle') return ` UI: the user chose a freestyle SAPUI5 app. When the service is active, scaffold the component with \`node ${path.join(ROOT, 'bin', 'rap.js')} fiori . --template freestyle --service <zui_service> --entity <main EntitySet>\` and then shape its views and controllers to what the user asked for (see "Freestyle UI5 apps"); keep Component.js and manifest.json, and keep the UI annotations too.`;
  const t = TEMPLATES[ui.template] ? ui.template : 'lrop';
  return ` UI: the user chose an SAP Fiori elements app with the template "${TEMPLATES[t]}". When the service is active, generate it with \`node ${path.join(ROOT, 'bin', 'rap.js')} fiori . --template ${t} --service <zui_service> --entity <main EntitySet>\` and make sure the annotations it needs are there${t === 'alp' || t === 'ovp' ? ' (an analytical view with @Aggregation.default measures and a @UI.chart, see "Analytics")' : ''}.`;
}
function uiLabel(ui) {
  if (!ui?.kind) return '';
  if (ui.kind === 'classic') return '\n\nUI: classic ABAP programs';
  if (ui.kind === 'forms') return '\n\nOutput: print form (Adobe form)';
  return ui.kind === 'freestyle' ? '\n\nUI: freestyle SAPUI5' : `\n\nUI: SAP Fiori elements, ${TEMPLATES[ui.template] || TEMPLATES.lrop}`;
}

function slug(prompt) {
  return prompt.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(w => w && !STOP.has(w)).slice(0, 3).join('-');
}
function title(prompt) {
  const s = slug(prompt).replace(/-/g, ' ');
  return s ? s.replace(/\b\w/g, c => c.toUpperCase()) : '';
}
function sortKey(f) {
  const order = ['CLAUDE.md', 'src/', 'webapp/', 'data/', 'docs/'];
  const i = order.findIndex(o => f === o || f.startsWith(o));
  const kind = /\.tabl\./.test(f) ? 0 : /\.ddls\./.test(f) ? 1 : /\.bdef\./.test(f) ? 2 : /\.clas\./.test(f) ? 3 : /\.ddlx\./.test(f) ? 4 : /\.srvd\./.test(f) ? 5 : 6;
  return `${i < 0 ? 9 : i}${kind}${f}`;
}

// what the chat shows of a delivery
function summaryOf(m) {
  return { folder: m.folder, title: m.title, files: m.files, atc: m.atc, tests: m.tests, created: m.created };
}
// a source of the app changed after the time (ms)
function changedSince(dir, since) {
  const walk = d => { try { return fs.readdirSync(d, { withFileTypes: true }).some(e => e.isDirectory() ? walk(path.join(d, e.name)) : fs.statSync(path.join(d, e.name)).mtimeMs >= since); } catch { return false; } };
  return ['src', 'webapp', 'data'].some(f => walk(path.join(dir, f)));
}
