// Classic ABAP engine, host process (one per app): serves the app's reports and module pools, converted and
// transpiled by build.mjs, through open-abap's report/dynpro framework (IF_HTTP_EXTENSION handler) with a
// new look: our launcher replaces the workbench, and every page gets the RAP Studio theme instead of the
// SAP GUI window chrome.
//   node src/classic/host.mjs <work dir> <port>      (RAP_CLASSIC_DB = the app's database file)
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { createServer } from 'node:http';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as ui from './system.mjs';
import { listFunctions as fnList, runFunction, shapeOf } from './functions.mjs';
// the function modules with the dictionary kind of each parameter type (the test form shows JSON fields for tables)
const listFunctions = w => fnList(w).map(f => ({ ...f, sections: Object.fromEntries(Object.entries(f.sections).map(([s, ps]) =>
  [s, ps.map(p => ({ ...p, shape: globalThis.abap?.DDIC?.[p.typ]?.objectType, values: globalThis.abap?.DDIC?.[p.typ]?.fixedValues, table: s === 'TABLES',
    ...(s === 'EXCEPTIONS' || !globalThis.abap ? {} : shapeOf(globalThis.abap, p, s)) }))])) }));

const HERE = path.dirname(fileURLToPath(import.meta.url));
const [work, portArg] = process.argv.slice(2);
const output = path.resolve(work, 'output');
Error.stackTraceLimit = Infinity;
process.env.RAP_CLASSIC_EXTERNALS = path.join(path.resolve(work), 'externals.json');
await import(pathToFileURL(path.join(output, 'init.mjs')).href);
const sy = globalThis.abap.builtin.sy.get();
sy.uname?.set?.(process.env.RAP_CLASSIC_USER || 'DEVELOPER');
sy.sysid?.set?.('RAP'); sy.mandt?.set?.('100');
const shim = globalThis.abap.Classes.CL_EXPRESS_ICF_SHIM;
const { session, installLocks } = await import('./locks.mjs');
const locks = installLocks(globalThis.abap, globalThis.abap.context.databaseConnections.DEFAULT);
// AUTHORITY-CHECK (the converter calls the host's authority_check per field): the studio's users and roles, like RAP
// code; without users everything is allowed (development)
{
  const { authStoreFor, authorityCheck } = await import('../server/auth.js');
  const store = process.env.RAP_CLASSIC_USERS && authStoreFor(path.dirname(process.env.RAP_CLASSIC_USERS));
  const cls = globalThis.abap.Classes.ZCL_GG_HOST_COMPATIBILITY;
  const str = x => String(x?.get?.() ?? x ?? '').replace(/ +$/, '');
  if (cls) cls.prototype.zif_gg_compatibility_v1$authority_check = async function (INPUT) {
    const auths = store ? store.authorizationsOf(str(globalThis.abap.builtin.sy.get().uname)) : null;
    const ok = authorityCheck(auths, str(INPUT?.iv_object), { [str(INPUT?.iv_id)]: str(INPUT?.iv_value) }) === 0;
    return new globalThis.abap.types.Character(1).set(ok ? 'X' : '');
  };
}
// cl_gui_frontend_services=>gui_download (and clipboard_export) in a report: the vendor host knows a current session
// only on dynpro screens, so a download from the selection screen, START-OF-SELECTION or a list event failed. The
// newest session is the current one, and the page the browser gets next (selection screen, message or list) saves
// its files.
{
  const compat = globalThis.abap.Classes.ZCL_GG_HOST_COMPATIBILITY, renderer = globalThis.abap.Classes.ZCL_GG_HOST_RENDERER;
  if (compat && renderer) {
    let latest;
    const construct = compat.prototype.constructor_;
    compat.prototype.constructor_ = async function (INPUT) {
      const self = await construct.call(this, INPUT);
      latest = this;
      compat.go_current.set(this.me);
      return self;
    };
    const withDownloads = name => {
      const render = renderer[name];
      if (render) renderer[name] = async function (INPUT) {
        const html = await render.call(this, INPUT);
        const files = latest?.FRIENDS_ACCESS_INSTANCE?.mt_downloads;
        if (!files?.array?.().length) return html;
        const extra = (await renderer.render_downloads({ it_downloads: files })).get();
        files.clear();
        const page = html.get(), at = page.lastIndexOf('</body>');
        return html.set(at < 0 ? page + extra : page.slice(0, at) + extra + page.slice(at));
      };
    };
    for (const name of ['render_selection', 'render_message', 'render_list']) withDownloads(name);
  }
}
// ABAP semantics the open-abap runtime lacks:
// - a TABLES parameter of a function module has a header line, also when the caller passes a table without one
//   (a class calling the FM): the FM's LOOP AT it_items. / it_items-field work on it; the caller's table is back as
//   it was afterwards
// - MOVE-CORRESPONDING itab1 TO itab2 with tables without header lines moves the tables line by line
{
  const A = globalThis.abap;
  const isTab = t => typeof t?.array === 'function' && typeof t?.getRowType === 'function';
  const fms = A.FunctionModules || {};
  for (const [name, fn] of Object.entries(fms)) {
    if (typeof fn !== 'function') continue;
    fms[name] = async function (INPUT) {
      const added = [];
      for (const t of Object.values(INPUT?.tables || {})) {
        const tab = t?.constructor?.name === 'FieldSymbol' ? t.getPointer() : t;
        if (isTab(tab) && tab.header === undefined) { tab.header = tab.getRowType().clone(); added.push(tab); }
      }
      try { return await fn.call(this, INPUT); }
      finally { for (const tab of added) delete tab.header; }
    };
  }
  const move = A.statements.moveCorresponding;
  const deref = x => (x?.constructor?.name === 'FieldSymbol' ? x.getPointer() : x);
  A.statements.moveCorresponding = function (source, target, ...rest) {
    const src = deref(source), tgt = deref(target);
    if (isTab(src) && isTab(tgt) && src.header === undefined && tgt.header === undefined) {
      tgt.clear();
      for (const row of src.array()) {
        const line = tgt.getRowType().clone();
        if (line?.constructor?.name === 'Structure' && row?.constructor?.name === 'Structure') move.call(this, row, line); else line.set(row);
        tgt.append(line);
      }
      return tgt;
    }
    return move.call(this, source, target, ...rest);
  };
}
// the user's date format (their settings, DD.MM.YYYY by default) everywhere: screens, selection screens and the ALV
// grid show it (theme.js), and |{ d DATE = USER }| / WRITE lists (which use it) as well, instead of the machine's locale
const { userDate } = await import('./userdate.mjs');
const { settingsOf } = await import('../server/usersettings.js');
const settingsDir = process.env.RAP_CLASSIC_USERS ? path.dirname(process.env.RAP_CLASSIC_USERS) : path.resolve(work, '..', '..');
{
  const A = globalThis.abap;
  const fmt = A.templateFormatting;
  if (fmt) A.templateFormatting = function (source, options, ...rest) {
    if (options && (options.date === 'user' || options.date === 'environment')) {
      const text = String(fmt.call(this, source, { ...options, date: undefined }, ...rest));
      const m = /^(\d{4})(\d{2})(\d{2})$/.exec(text.trim());
      return m ? (m[0] === '00000000' ? userDate.pattern.replace(/[DMY]/g, '0') : userDate.format(m[0])) : text;
    }
    return fmt.call(this, source, options, ...rest);
  };
}
// field labels of the app's data elements (short / medium / long / heading of DD04V): open-abap's DDIC knows only
// the description, so cl_abap_elemdescr->get_ddic_field (ALV column headings, field catalogs) gets them here
{
  const dir = path.join(path.resolve(work), 'app');
  const tag = (x, t) => new RegExp(`<${t}>([^<]*)</${t}>`).exec(x)?.[1]?.trim() || '';
  for (const f of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
    if (!/\.dtel\.xml$/i.test(f)) continue;
    const x = fs.readFileSync(path.join(dir, f), 'utf8');
    const name = (tag(x, 'ROLLNAME') || f.split('.')[0]).toUpperCase();
    const d = globalThis.abap.DDIC?.[name];
    if (d) d.labels = { s: tag(x, 'SCRTEXT_S'), m: tag(x, 'SCRTEXT_M'), l: tag(x, 'SCRTEXT_L'), h: tag(x, 'REPTEXT') };
  }
  const elem = globalThis.abap.Classes.CL_ABAP_ELEMDESCR;
  const get = elem?.prototype.get_ddic_field;
  if (get) elem.prototype.get_ddic_field = async function (INPUT) {
    const r = await get.call(this, INPUT);
    const labels = globalThis.abap.DDIC?.[String(this.relative_name?.get?.() ?? '').trim().toUpperCase()]?.labels;
    const c = r?.get?.();
    if (labels && c) for (const [k, v] of [['scrtext_s', labels.s], ['scrtext_m', labels.m], ['scrtext_l', labels.l], ['reptext', labels.h]]) if (v && c[k]) c[k].set(v);
    return r;
  };
}
// the debugger: hooks in the app's statements (debugmap.mjs) stop a dialog step while the studio debugs the program
const { installDebugger } = await import('./debug.mjs');
const debug = installDebugger(globalThis.abap, path.resolve(work));
const { installForms } = await import('./forms.mjs');
const forms = installForms(globalThis.abap, globalThis.abap.context.databaseConnections.DEFAULT, { formsDir: path.join(path.resolve(work), 'forms') });
// application logs saved with if_bali_log_db also go to the app's database (zcl_rap_bal_store)
{
  const dbCls = globalThis.abap.Classes.CL_BALI_LOG_DB, store = globalThis.abap.Classes.ZCL_RAP_BAL_STORE;
  const save = dbCls?.prototype.save_log;
  if (save && store) dbCls.prototype.save_log = async function (INPUT) { await save.call(this, INPUT); await store.save({ log: INPUT.log }); };
}
const manifest = () => { try { return JSON.parse(fs.readFileSync(path.join(work, 'manifest.json'), 'utf8')); } catch { return { app: '', programs: [] }; } };

const app = express();
app.disable('x-powered-by');
// only this machine's loopback names (no DNS rebinding) and no changes requested by other sites (no CSRF)
{
  const { requestGuard } = await import('../server/auth.js');
  app.use((req, res, next) => { if (!requestGuard(req, res, { host: '127.0.0.1' })) next(); });
}
// the user of the request: with users, the studio's logon (its signed cookie rap_csig; a browser without it is refused,
// local tools without a browser run as the engine's user); without users, the studio's user cookie. The user is
// sy-uname (AUTHORITY-CHECK, admin fields, locks) and decides the date format.
{
  const { authStoreFor, verifyUser } = await import('../server/auth.js');
  const store = process.env.RAP_CLASSIC_USERS ? authStoreFor(settingsDir) : null;
  const cookie = (req, name) => { try { return decodeURIComponent(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`).exec(req.headers.cookie || '')?.[1] || ''); } catch { return ''; } };
  app.use((req, res, next) => {
    let user = process.env.RAP_CLASSIC_USER || 'DEVELOPER';
    if (store?.enabled) {
      const signed = verifyUser(settingsDir, cookie(req, 'rap_csig'));
      if (signed) user = signed;
      else if (/mozilla/i.test(req.headers['user-agent'] || '')) {   // a browser (Node's fetch also sends sec-fetch-*)
        return res.status(401).type('html').send(ui.page('Log on first', '<section class="rl-card"><h2>Log on to RAP Studio first</h2><p>Classic programs run as the user logged on to the studio. Log on there, then open the program again from the app.</p></section>', { app: manifest().title }));
      }
    } else if (cookie(req, 'rap_user')) user = cookie(req, 'rap_user').toUpperCase().slice(0, 12);
    globalThis.abap.builtin.sy.get().uname?.set?.(user);
    userDate.code = settingsOf(settingsDir, user).dateFormat;
    next();
  });
}
app.set('etag', false);
app.use(express.raw({ type: '*/*', limit: 1 << 20 }));

// the new look: theme stylesheet and script in every HTML page of the engine
app.use((req, res, next) => {
  const send = res.send.bind(res);
  res.send = body => {
    const type = String(res.get('content-type') || '');
    if ((type.includes('text/html') || (!type && typeof body === 'string' && /^\s*<!doctype html/i.test(body))) && (typeof body === 'string' || Buffer.isBuffer(body))) {
      let html = String(body);
      const m = manifest();
      // the engine's own name never shows: page title, menu-bar brand and the start page's logo say RAP Studio
      html = html.replace(/<title>open-abap GUI<\/title>/gi, `<title>${ui.esc(m.title || m.app || 'Classic programs')} · RAP Studio</title>`)
        .replace(/(<span class="wb-(?:brand|wordmark)">)open-abap(<\/span>)/g, '$1RAP Studio$2')
        .replace(/aria-label="open-abap"/g, 'aria-label="RAP Studio"');
      html = html.replace('</head>', `<link rel="stylesheet" href="/__rap/theme.css"></head>`)
        .replace(/<body([^>]*)>/i, (all, attrs) => `<body${attrs} data-rap-app="${ui.esc(m.title || m.app)}" data-rap-datfm="${userDate.code}">`)
        .replace('</body>', `<script src="/__rap/theme.js"></script></body>`);
      return send(html);
    }
    return send(body);
  };
  next();
});
app.get('/__rap/theme.css', (req, res) => res.type('text/css').set('cache-control', 'no-cache').send(fs.readFileSync(path.join(HERE, 'theme.css'), 'utf8')));
app.get('/__rap/theme.js', (req, res) => res.type('text/javascript').set('cache-control', 'no-cache').send(fs.readFileSync(path.join(HERE, 'theme.js'), 'utf8')));
app.get('/__rap/health', (req, res) => res.json({ ok: true }));
// launcher instead of the SAP GUI workbench, and the system pages (jobs, logs, output, forms, tables)
app.get(['/', '/workbench'], (req, res) => res.type('html').send(ui.launcher(manifest(), listFunctions(work))));
const form = req => Object.fromEntries(new URLSearchParams(Buffer.isBuffer(req.body) ? req.body.toString('utf8') : ''));
const sql = () => db().db;
// function modules: test page (SE37) and JSON API
app.get('/__rap/functions', (req, res) => res.type('html').send(ui.functionsPage(manifest(), listFunctions(work))));
app.get('/__rap/functions/:name', (req, res) => res.type('html').send(ui.functionPage(manifest(), listFunctions(work).find(f => f.name === req.params.name.toUpperCase()))));
app.post('/__rap/functions/:name', async (req, res) => {
  const fn = listFunctions(work).find(f => f.name === req.params.name.toUpperCase());
  const values = form(req);
  const params = Object.fromEntries(Object.entries(values).filter(([, v]) => v !== ''));
  let result;
  try { result = await runFunction(globalThis.abap, work, req.params.name, params); await db()?.commit?.(); }
  catch (e) { await db()?.rollback?.(); result = { error: e.message, fields: e.fields, subrc: 0, ms: 0, exporting: {}, changing: {}, tables: {} }; }
  res.status(result.fields?.length ? 400 : 200).type('html').send(ui.functionPage(manifest(), fn, values, result));
});
app.get('/__rap/api/functions', (req, res) => res.json(listFunctions(work)));
app.post('/__rap/api/functions/:name', async (req, res) => {
  try { const r = await runFunction(globalThis.abap, work, req.params.name, body(req).params || body(req)); await db()?.commit?.(); res.json(r); }
  catch (e) { await db()?.rollback?.(); res.status(e.status || 500).json({ error: e.message, ...(e.fields ? { fields: e.fields } : {}) }); }
});
app.get('/__rap/jobs', (req, res) => res.type('html').send(ui.jobsPage(manifest(), jobs, { notice: req.query.notice })));
app.post('/__rap/jobs', (req, res) => {
  const f = form(req);
  // from the schedule form (params as NAME=value lines) or from "Run in background" on a selection screen (fields)
  const params = f.fields ? JSON.parse(f.fields) : Object.fromEntries(String(f.params || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean)
    .map(l => { const i = l.indexOf('='); return i > 0 ? [l.slice(0, i).trim().toUpperCase(), l.slice(i + 1).trim()] : null; }).filter(Boolean));
  // the form's local date and time, with the browser's time zone offset (minutes, as getTimezoneOffset)
  const startAt = f.start === 'at' && f.at ? Date.parse(`${f.at}Z`) + (Number(f.tz) || 0) * 60000 : Date.now();
  const program = String(f.program || '').toUpperCase();
  const count = jobs.create({ jobname: (f.jobname || `${program}_JOB`).toUpperCase().slice(0, 32), user: process.env.RAP_CLASSIC_USER || 'DEVELOPER',
    steps: [{ program, variant: f.variant || '', params }], startAt: Number.isFinite(startAt) ? startAt : Date.now(), periodMin: Number(f.period) || 0 });
  setTimeout(() => jobs.tick(), 50);
  res.redirect(303, `/__rap/jobs?notice=${encodeURIComponent(`Job ${count} scheduled`)}`);
});
app.get('/__rap/jobs/:count', (req, res) => res.type('html').send(ui.jobPage(manifest(), jobs.get(req.params.count))));
app.post('/__rap/jobs/:count/cancel', (req, res) => { jobs.cancel(req.params.count); res.redirect(303, `/__rap/jobs/${req.params.count}`); });
app.post('/__rap/jobs/:count/delete', (req, res) => { jobs.remove(req.params.count); res.redirect(303, '/__rap/jobs'); });
// JSON API for the command line (rap job / logs / form / table) and tests
const body = req => { try { return JSON.parse(Buffer.isBuffer(req.body) ? req.body.toString('utf8') : '{}') || {}; } catch { return {}; } };
app.get('/__rap/api/programs', (req, res) => res.json(manifest()));
// debugger channel of the studio: state (polled), breakpoints / active, commands at a stop
app.get('/__rap/debug', (req, res) => res.json(debug.state()));
app.post('/__rap/debug', (req, res) => res.json(debug.configure(body(req))));
app.post('/__rap/debug/cmd', (req, res) => { const b = body(req); res.json(debug.command(b.cmd, b)); });
app.get('/__rap/api/jobs', (req, res) => res.json(jobs.list(Number(req.query.top) || 50)));
app.get('/__rap/api/jobs/:count', (req, res) => res.json(jobs.get(req.params.count) || null));
app.post('/__rap/api/jobs', (req, res) => {
  const b = body(req);
  if (!b.program) return res.status(400).json({ error: 'program is missing' });
  const startAt = b.at ? Date.parse(b.at) : Date.now();
  const count = jobs.create({ jobname: String(b.jobname || `${b.program}_JOB`).toUpperCase().slice(0, 32), user: process.env.RAP_CLASSIC_USER || 'DEVELOPER',
    steps: [{ program: b.program, variant: b.variant || '', params: b.params || {} }], startAt: Number.isFinite(startAt) ? startAt : Date.now(), periodMin: Number(b.every) || 0 });
  setTimeout(() => jobs.tick(), 20);
  res.json(jobs.get(count));
});
app.post('/__rap/api/jobs/:count/cancel', (req, res) => res.json({ cancelled: jobs.cancel(req.params.count) }));
app.get('/__rap/api/logs', (req, res) => res.json(safeAll('SELECT * FROM zrap_balhdr ORDER BY created_at DESC LIMIT ?', Number(req.query.top) || 50)));
app.get('/__rap/api/logs/:handle', (req, res) => res.json({ header: safeAll('SELECT * FROM zrap_balhdr WHERE log_handle = ?', req.params.handle)[0] || null,
  messages: safeAll('SELECT item_no, severity, message FROM zrap_balmsg WHERE log_handle = ? ORDER BY item_no', req.params.handle) }));
app.get('/__rap/api/forms', (req, res) => res.json(forms.list().map(n => ({ name: n, title: forms.load(n)?.title || n }))));
// renders a form with the posted data (or its sample data); print=1 also puts it into the output queue
app.post('/__rap/api/forms/:name', async (req, res) => {
  try {
    const data = Object.keys(body(req)).length ? body(req) : (forms.load(req.params.name)?.sample || {});
    const r = await forms.render(req.params.name, data);
    let id = null;
    if (req.query.print) id = forms.store(req.params.name, req.query.title, r);
    const { pdfText } = await import('./client.mjs');
    res.json({ form: req.params.name.toUpperCase(), pages: r.pages, bytes: r.pdf.length, request: id, text: pdfText(r.pdf), pdf: id ? `/__rap/output/${id}.pdf` : null });
  } catch (e) { res.status(400).json({ error: e.message }); }
});
app.get('/__rap/api/outputs', (req, res) => res.json(forms.outputs(Number(req.query.top) || 50)));
app.get('/__rap/api/tables', (req, res) => res.json(safeAll("SELECT name FROM sqlite_master WHERE type IN ('table', 'view') ORDER BY name").map(t => t.name)));
app.get('/__rap/api/tables/:name', (req, res) => {
  if (!/^[\w/$#]{1,64}$/.test(req.params.name)) return res.status(400).json({ error: 'Invalid table name' });
  const cols = safeAll(`PRAGMA table_info("${req.params.name.replace(/"/g, '')}")`).map(c => c.name);
  if (!cols.length) return res.status(404).json({ error: `Table ${req.params.name} does not exist` });
  const where = Object.entries(req.query).filter(([k]) => cols.includes(k));
  const sqlText = `SELECT * FROM "${req.params.name}"${where.length ? ` WHERE ${where.map(([k]) => `"${k}" LIKE ?`).join(' AND ')}` : ''} LIMIT ${Math.min(Number(req.query.$top) || 100, 5000)}`;
  res.json({ table: req.params.name, columns: cols, rows: safeAll(sqlText, ...where.map(([, v]) => String(v).replace(/\*/g, '%'))) });
});
function safeAll(q, ...args) { try { return sql().prepare(q).all(...args); } catch { return []; } }
// F4 value help of screen fields: which fields have one (the page asks once), and the hit list of a field
{
  const vh = await import('./valuehelp.mjs');
  const appDir = path.resolve(work, '..', '..');
  const lookup = (name, program) => { const cat = vh.catalog(appDir); const ref = vh.resolveField(cat, name, program); return { cat, ref, help: vh.helpOf(cat, ref) }; };
  app.get('/__rap/f4/fields', (req, res) => {
    const names = String(req.query.names || '').split(',').map(s => s.trim()).filter(n => /^[\w/-]{1,80}$/.test(n)).slice(0, 200);
    res.json(Object.fromEntries(names.map(n => { try { return [n, !!lookup(n, String(req.query.program || '').toUpperCase()).help]; } catch { return [n, false]; } })));
  });
  app.get('/__rap/f4', (req, res) => {
    const name = String(req.query.field || '');
    if (!/^[\w/-]{1,80}$/.test(name)) return res.status(400).json({ error: 'field is missing' });
    const { cat, ref, help } = lookup(name, String(req.query.program || '').toUpperCase());
    if (!help) return res.status(404).json({ error: `No value help for ${name}` });
    res.json(vh.hitList(cat, ref, help, safeAll, req.query.q));
  });
}
app.get('/__rap/logs', (req, res) => res.type('html').send(ui.logsPage(manifest(), sql())));
app.get('/__rap/logs/:handle', (req, res) => res.type('html').send(ui.logPage(manifest(), sql(), req.params.handle)));
app.get('/__rap/output', (req, res) => res.type('html').send(ui.outputPage(manifest(), forms)));
app.get('/__rap/output/:id.pdl', (req, res) => {
  const o = forms.output(Number(req.params.id));
  if (!o?.pdl) return res.status(404).send('No print data');
  const ext = { PS: 'ps', ZPL: 'zpl' }[o.format] || 'pdf';
  res.type({ PS: 'application/postscript', ZPL: 'text/plain' }[o.format] || 'application/pdf').set('Content-Disposition', `inline; filename="output-${o.id}.${ext}"`).send(Buffer.from(o.pdl));
});
app.get('/__rap/output/:id.pdf', (req, res) => {
  const o = forms.output(Number(req.params.id));
  if (!o) return res.status(404).type('text').send('No such output request');
  if (!o.pdf) return res.redirect(303, `/__rap/output/${o.id}.pdl`);   // print data only (PostScript, ZPL)
  res.type('application/pdf').set('content-disposition', `inline; filename="${String(o.title).replace(/[^\w .-]/g, '_')}.pdf"`).send(Buffer.from(o.pdf));
});
app.get('/__rap/output/:id', (req, res) => {
  const o = forms.output(Number(req.params.id));
  res.type('html').send(o ? ui.pdfPage(manifest(), `${o.title} (request ${o.id})`, `/__rap/output/${o.id}.pdf`, '/__rap/output') : ui.page('Output', '<section class="rl-card rl-empty"><p>No such output request.</p></section>', { app: manifest().title }));
});
app.get('/__rap/forms/:name', (req, res, next) => {
  if (req.params.name.endsWith('.pdf')) return next();
  res.type('html').send(ui.pdfPage(manifest(), `Form ${req.params.name.toUpperCase()} (sample data)`, `/__rap/forms/${encodeURIComponent(req.params.name)}.pdf`, '/__rap/forms'));
});
app.post('/__rap/output/:id/delete', (req, res) => { forms.remove(Number(req.params.id)); res.redirect(303, '/__rap/output'); });
app.get('/__rap/forms', (req, res) => res.type('html').send(ui.formsPage(manifest(), forms)));
app.get('/__rap/forms/:name.pdf', async (req, res) => {
  try { res.type('application/pdf').send(await forms.preview(req.params.name)); }
  catch (e) { res.status(404).type('text').send(e.message); }
});
app.get('/__rap/tables', (req, res) => res.type('html').send(ui.tablesPage(manifest(), sql(), ui.readJson(path.join(work, 'externals.json'), []))));
app.get('/__rap/tables/:name', (req, res) => res.type('html').send(ui.tablePage(manifest(), sql(), req.params.name, req.query)));

// the PDFs returned to programs (getpdf = 'X'), the latest 30, for the links on their pages
const previews = new Map();
let previewSeq = 0;
app.get('/__rap/preview/:id.pdf', (req, res) => {
  const p = previews.get(Number(req.params.id));
  if (!p) return res.status(404).type('text').send('This PDF is no longer available: run the program again');
  res.type('application/pdf').set('content-disposition', `inline; filename="${String(p.title || p.form).replace(/[^\w .-]/g, '_')}.pdf"`).send(Buffer.from(p.pdf));
});
// a runtime error of a program: recorded in the app's runtime errors (table rap_dump, as the RAP runtime does:
// Problems -> Runtime errors) with the ABAP call stack from the debugger's map and the source around the statement
function recordDump(e, context, text = '') {
  const frames = debug.framesOf(e);
  const message = text || String(e?.message || e);
  const exception = String(e?.constructor?.INTERNAL_NAME || e?.constructor?.name || 'Error').replace(/^PROG-[^-]+-/, '').toUpperCase();
  try {
    const d = sql();
    d.exec('CREATE TABLE IF NOT EXISTS rap_dump (id INTEGER PRIMARY KEY, created BIGINT, username TEXT, context TEXT, exception TEXT, message TEXT, file TEXT, line INTEGER, frames TEXT, source TEXT)');
    const top = frames[0];
    let source = [];
    if (top?.file) {
      const appDir = path.resolve(work, '..', '..');
      try { source = fs.readFileSync(path.join(appDir, top.file), 'utf8').split('\n').slice(Math.max(0, top.line - 6), top.line + 4).map((text, k) => ({ line: Math.max(0, top.line - 6) + k + 1, text })); } catch {}
    }
    const id = Number(d.prepare('SELECT COALESCE(MAX(id), 0) + 1 AS n FROM rap_dump').get().n);
    d.prepare('INSERT INTO rap_dump (id, created, username, context, exception, message, file, line, frames, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(id, Date.now(), String(globalThis.abap.builtin.sy.get().uname?.get?.() ?? 'DEVELOPER').trim(), `classic ${context}`, exception, message, top?.file || '', top?.line ?? null,
        JSON.stringify(frames.map(f => ({ cls: '', method: f.label, file: f.file, line: f.line }))), JSON.stringify(source));
    d.prepare('DELETE FROM rap_dump WHERE id <= ?').run(id - 200);
  } catch (x) { if (process.env.RAP_DEBUG) console.error('runtime error not recorded:', x); }
  return { message, frames };
}
const SESSION_SY = ['dbcnt', 'subrc', 'tabix', 'index', 'fdpos'];
const sysOf = new Map();
function keepSy(id) {
  if (!id) return;
  const sys = globalThis.abap.builtin.sy.get();
  sysOf.set(id, Object.fromEntries(SESSION_SY.map(k => { try { return [k, sys[k]?.get?.() ?? 0]; } catch { return [k, 0]; } })));
  if (sysOf.size > 500) sysOf.delete(sysOf.keys().next().value);
}
// an exception no ABAP code caught: the framework shows its error page (send_failure); it is recorded as a runtime
// error too, and the page names the statement
{
  const H = globalThis.abap.Classes.ZCL_GG_HTTP_HANDLER;
  const fail = H?.send_failure;
  if (fail) H.send_failure = async function (INPUT) {
    const e = INPUT?.ix_error?.get?.() ?? INPUT?.ix_error;
    const step = session.getStore();
    let text = '';
    try { text = String((await e?.get_text?.())?.get?.() ?? '').trim(); } catch {}
    const d = recordDump(e, programOf.get(step?.id) || globalThis.abap.builtin.sy.get().cprog?.get?.()?.trim?.() || '', text);
    if (step) step.dump = d;
    return fail.call(this, INPUT);
  };
}
// every request is one dialog step: its database changes are committed at the end (implicit DB commit),
// or rolled back when the program stopped with an error
const db = () => globalThis.abap.context.databaseConnections.DEFAULT;
// the program's session (the framework's session_id field) owns the locks it sets
const sessionOf = req => {
  const body = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : '';
  return new URLSearchParams(body).get('session_id') || req.query.session_id || null;
};
// sy-cprog: the program of the request (started by name or transaction, then remembered per session)
const programOf = new Map();
const programFor = req => {
  if (req.path === '/program' && req.query.name) return String(req.query.name).toUpperCase();
  if (req.path === '/transaction' && req.query.tcode) return manifest().programs.find(p => p.tcode === String(req.query.tcode).toUpperCase())?.name;
  return programOf.get(sessionOf(req));
};
app.all('*', async (req, res) => {
  // a program (or the transaction of one) that did not convert: its errors, not an empty workbench
  const failed = (manifest().failed || []).find(p => (req.path === '/program' && String(req.query.name || '').toUpperCase() === p.name)
    || (req.path === '/transaction' && p.tcode && String(req.query.tcode || '').toUpperCase() === p.tcode));
  if (failed) {
    const src = `src/${path.basename(String(failed.file || `${failed.name.toLowerCase()}.prog.abap`))}`;
    return res.status(409).type('html').send(ui.page(`${failed.name}: not runnable`, `<section class="rl-card"><h2>${ui.esc(failed.name)} cannot run on the classic engine</h2>
<p>The program did not convert. Fix these errors (they are in Problems too) and activate again:</p>
<ul class="rl-errors">${(failed.errors || []).map(e => `<li><code>${ui.esc(src)}${e.line ? `:${e.line}` : ''}</code> ${ui.esc(e.message)}</li>`).join('') || '<li>The conversion failed.</li>'}</ul>
<a class="rl-btn" href="/">Back to programs</a></section>`, { app: manifest().title }));
  }
  const id = sessionOf(req);
  if (id) locks.touch(id);
  const program = programFor(req);
  if (program) globalThis.abap.builtin.sy.get().cprog?.set?.(program);
  const send = res.send.bind(res);
  res.send = body => {
    const sid = /name="session_id" value="([^"]+)"/.exec(String(body))?.[1];
    if (sid && program) programOf.set(sid, program);
    keepSy(sid || id);
    return send(body);
  };
  // PDFs a print program asked for with getpdf = 'X' (forms.mjs): shown on the page of the dialog step
  const step = { id: id || `request-${Date.now()}-${Math.random()}` };
  const sendPage = res.send;
  res.send = body => {
    // a runtime error the framework reported: where it happened
    const at = step.dump?.frames?.[0];
    if (at && (typeof body === 'string' || Buffer.isBuffer(body))) {
      body = String(body);
      const note = `<p class="rx-dump">Runtime error at <code>${ui.esc(at.file)}:${at.line}</code> (${ui.esc(at.label)}): recorded under Problems → Runtime errors.</p>`;
      body = /<main\b[^>]*>/i.test(body) ? body.replace(/<main\b[^>]*>/i, m => m + note) : body.replace(/<\/body>/i, `${note}</body>`);
      step.dump = null;
    }
    if (step.previews?.length && Buffer.isBuffer(body) && /html/i.test(String(res.get('content-type') || ''))) body = body.toString('utf8');
    if (step.previews?.length && typeof body === 'string' && /<\/body>/i.test(body)) {
      const links = step.previews.splice(0).map(p => {
        const n = ++previewSeq;
        previews.set(n, p);
        if (previews.size > 30) previews.delete(previews.keys().next().value);
        return `<li><a href="/__rap/preview/${n}.pdf" target="_blank" rel="noopener">${ui.esc(p.title || p.form)}</a> <small>${ui.esc(p.form)}, ${p.pages} page(s), ${p.pdf.length} bytes</small></li>`;
      }).join('');
      const card = `<section class="rx-pdf" aria-label="PDF returned to the program"><strong>PDF returned to the program (getpdf)</strong><ul>${links}</ul></section>`;
      body = /<main\b[^>]*>/i.test(body) ? body.replace(/<main\b[^>]*>/i, m => m + card) : body.replace(/<\/body>/i, `${card}</body>`);
    }
    return sendPage(body);
  };
  // the system fields of a program belong to its session (one engine process serves all sessions): a dialog step
  // starts with the values its session's last step ended with (sy-dbcnt of the last SQL statement of that program,
  // as on SAP), a new session with initial ones
  const sys = globalThis.abap.builtin.sy.get();
  const saved = sysOf.get(id) || {};
  for (const k of SESSION_SY) { try { sys[k]?.set?.(saved[k] ?? 0); } catch {} }
  // the page goes out after the dialog step's commit: whoever reacts to it (the next step, another session, a test)
  // sees the saved data
  const sendNow = res.send;
  let pending = null;
  res.send = body => { pending = { body }; return res; };
  const flush = () => { res.send = sendNow; if (pending && !res.headersSent) sendNow.call(res, pending.body); pending = null; };
  try { await debug.request(program || req.path, () => session.run(step, () => shim.run({ req, res, class: 'ZCL_GG_HTTP_HANDLER' }))); await db()?.commit?.(); flush(); }
  catch (e) {
    await db()?.rollback?.();
    res.send = sendNow; pending = null;
    if (e?.rapDebugStop) { if (!res.headersSent) res.type('html').send(ui.page('Stopped', `<section class="rl-card"><h2>${ui.esc(e.message)}</h2><a class="rl-btn" href="/">Back to programs</a></section>`, { app: manifest().title })); return; }
    console.error(`${req.method} ${req.originalUrl} failed: ${e?.stack || e}`);
    const dump = recordDump(e, program || req.path);
    const at = dump.frames[0];
    if (!res.headersSent) res.status(500).type('html').send(ui.page('Error', `<section class="rl-card"><h2>The program stopped with an error</h2><pre class="rl-error">${ui.esc(dump.message)}</pre>
${at ? `<p>at <code>${ui.esc(at.file)}:${at.line}</code> (${ui.esc(at.label)})</p>` : ''}${dump.frames.length > 1 ? `<details><summary>Call stack</summary><ol>${dump.frames.map(f => `<li><code>${ui.esc(f.file)}:${f.line}</code> ${ui.esc(f.label)}</li>`).join('')}</ol></details>` : ''}
<p class="rs-muted">Recorded under Problems → Runtime errors.</p><a class="rl-btn" href="/">Back to programs</a></section>`, { app: manifest().title }));
  }
});

const server = createServer(app);
let jobs = null;
// the port asked for may still be held by the previous host for a moment: try again, then take any free port
let listenTries = 0;
server.on('error', e => {
  if (e.code !== 'EADDRINUSE') throw e;
  setTimeout(() => server.listen(++listenTries > 20 ? 0 : Number(portArg || 0), '127.0.0.1'), 100);
});
server.listen(Number(portArg || 0), '127.0.0.1', async () => {
  const { installJobs } = await import('./jobs.mjs');
  jobs = installJobs(globalThis.abap, db(), { port: server.address().port, log: m => console.log(`[classic] ${m}`) });
  console.log(`[classic] ready on ${server.address().port}`);
});
const stop = () => { server.closeAllConnections?.(); server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 1500).unref(); };
process.on('SIGTERM', stop);
process.on('SIGINT', stop);

