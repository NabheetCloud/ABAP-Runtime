// The delivery documents of a development (rap deliver <app>): technical specification, QA test report with
// screenshots and ATC check report, as Word documents (and PDF when LibreOffice is installed) in
// <app>/docs/<date>-<topic>/ (the docs folder of the studio's Code tab). The AI agent describes the change in .rap/delivery.json (purpose, design,
// test cases); without it the documents are built from the sources. The ATC quick fixes are applied first, the
// test cases run on the app (reports on the classic engine, OData, console classes) and the pages are
// photographed with a headless Chrome.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Docx } from './docx.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const readJson = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const today = (d = new Date()) => d.toISOString().slice(0, 10);
const dmy = (d = new Date()) => `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
const slug = s => String(s || 'delivery').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'delivery';
const words = (list, one, many = `${one}s`) => `${list} ${list === 1 ? one : many}`;

const KINDS = [
  [/\.prog\.abap$/, 'Program'], [/\.clas\.testclasses\.abap$/, 'Unit tests'], [/\.clas\.locals_imp\.abap$/, 'Class (local types)'], [/\.clas\.abap$/, 'Class'],
  [/\.intf\.abap$/, 'Interface'], [/\.fugr\..*\.abap$/, 'Function module'], [/\.tabl\.cds$/, 'Table'], [/\.ddls\.asddls$/, 'CDS view'],
  [/\.ddlx\.asddlxs$/, 'Metadata extension'], [/\.bdef\.asbdef$/, 'Behavior definition'], [/\.srvd\.srvdsrv$/, 'Service definition'],
  [/\.dcls\.asdcls$/, 'Access control'], [/\.msag\.json$/, 'Message class'], [/\.form\.json$/, 'Print form'], [/\.tran\.xml$/, 'Transaction'],
  [/\.enqu\.xml$/, 'Lock object'], [/\.dtel\.xml$/, 'Data element'], [/\.doma\.xml$/, 'Domain'], [/\.ttyp\.xml$/, 'Table type'],
  [/\.prog\.screen_\d+\.abap$/, 'Screen flow logic'], [/\.xslt\.source\.xml$/, 'Transformation'], [/\.sajc\.json$/, 'Job catalog entry'], [/\.sajt\.json$/, 'Job template'],
];
const kindOf = f => KINDS.find(([re]) => re.test(f))?.[1];

// ---------------------------------------------------------------- what the sources tell
function inventory(dir) {
  const src = path.join(dir, 'src');
  const files = fs.existsSync(src) ? fs.readdirSync(src).filter(f => kindOf(f)).sort() : [];
  return files.map(f => {
    const text = fs.readFileSync(path.join(src, f), 'utf8');
    const name = f.split('.')[0].toUpperCase();
    return { file: `src/${f}`, name, kind: kindOf(f), lines: text.split('\n').length, text };
  });
}
// a classic program: title, selection texts, selection screen elements, tables read, authorization objects
function programInfo(dir, obj) {
  const xml = fs.existsSync(path.join(dir, obj.file.replace(/\.abap$/, '.xml'))) ? fs.readFileSync(path.join(dir, obj.file.replace(/\.abap$/, '.xml')), 'utf8') : '';
  const texts = {};
  for (const m of xml.matchAll(/<item>\s*<ID>([RS])<\/ID>\s*(?:<KEY>([^<]*)<\/KEY>\s*)?<ENTRY>([^<]*)<\/ENTRY>/g)) texts[m[1] === 'R' ? '' : m[2].trim().toUpperCase()] = m[3].replace(/^D {7}/, '').trim();
  const code = obj.text.split('\n').filter(l => !/^\s*\*/.test(l)).map(l => l.replace(/".*$/, '')).join('\n');
  // PARAMETERS / SELECT-OPTIONS statements, chained ones (PARAMETERS: a ..., b ...) too
  const fields = [...code.matchAll(/^\s*(PARAMETERS|PARAMETER|SELECT-OPTIONS)\b\s*:?([^.]*)\./gim)].flatMap(m => m[2].split(',').map(x => /^\s*(\w+)\s*(.*)$/s.exec(x)).filter(Boolean).map(([, name, rest]) => ({
    name: name.toUpperCase(), kind: /SELECT/i.test(m[1]) ? 'Select-option' : /AS\s+CHECKBOX/i.test(rest) ? 'Checkbox' : /RADIOBUTTON/i.test(rest) ? 'Radio button' : 'Parameter',
    type: (/(?:FOR|TYPE|LIKE)\s+([\w\-/]+(?:\s+LENGTH\s+\d+)?)/i.exec(rest) || [])[1] || '', text: texts[name.toUpperCase()] || '', mandatory: /OBLIGATORY/i.test(rest) })));
  const tables = [...new Set([...code.matchAll(/\b(?:FROM|JOIN)\s+([a-z][\w/]*)/gi)].map(m => m[1].toLowerCase()).filter(t => !/^(table|@)/.test(t)))].sort();
  const auth = [...new Set([...code.matchAll(/AUTHORITY-CHECK\s+OBJECT\s+'([^']+)'/gi)].map(m => m[1]))];
  return { title: texts[''] || '', fields, tables, auth };
}

// ---------------------------------------------------------------- screenshots (headless Chrome)
export function chromePath() {
  const list = [process.env.RAP_CHROME, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'].filter(Boolean);
  return list.find(p => fs.existsSync(p)) || null;
}
function screenshot(chrome, target, out, { width = 1200, height = 860, tmp } = {}) {
  if (!chrome) return null;
  const r = spawnSync(chrome, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check',
    `--user-data-dir=${path.join(tmp, 'chrome')}`, `--window-size=${width},${height}`, '--virtual-time-budget=4000', `--screenshot=${out}`, target], { timeout: 60000, stdio: 'ignore' });
  return r.status === 0 && fs.existsSync(out) ? fs.readFileSync(out) : null;
}
// a page the engine returned (HTML of a POST): saved with a <base> so its styles load, then photographed
function shootHtml(chrome, html, base, out, tmp) {
  const f = path.join(tmp, `${path.basename(out, '.png')}.html`);
  fs.writeFileSync(f, String(html).replace(/<head([^>]*)>/i, `<head$1><base href="${base}">`));
  return screenshot(chrome, `file://${f}`, out, { tmp });
}

// ---------------------------------------------------------------- test cases
// "program ZREP S_WERKS-LOW=1010", "odata GET <srv>/<Set>?$top=3", "class zcl_x", "ui [path]"
function parseRun(run) {
  const parts = String(run || '').match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g)?.map(p => p.replace(/^(["'])(.*)\1$/, '$2')) || [];
  const kind = (parts.shift() || '').toLowerCase();
  const values = Object.fromEntries(parts.filter(p => /^[^=]+=/.test(p)).map(p => [p.slice(0, p.indexOf('=')), p.slice(p.indexOf('=') + 1)]));
  return { kind, parts, values };
}
const firstLine = s => String(s || '').split('\n').map(l => l.trim()).find(l => l) || '';
const expectOk = (t, text) => !t.expect || String(text).toLowerCase().includes(String(t.expect).toLowerCase());

async function runTests(dir, tests, { app, port, chrome, tmp, log }) {
  const out = [], shots = [];
  let eng = null, seenSelection = new Set();
  const classic = async () => {
    if (eng) return eng;
    const { engine } = await import('../classic/cli.mjs');
    eng = await engine(dir, { soft: true });
    return eng;
  };
  for (const [i, t] of tests.entries()) {
    const id = t.id || `FT-${String(i + 1).padStart(2, '0')}`;
    const r = { id, title: t.title || t.run, run: t.run, expected: t.expected || (t.expect ? `shows "${t.expect}"` : 'runs without error'), actual: '', status: 'Fail', evidence: '' };
    const { kind, parts, values } = parseRun(t.run);
    try {
      if (kind === 'program') {
        const e = await classic();
        if (e.error) { r.actual = `classic programs do not compile: ${(e.diagnostics[0]?.message || e.error)}`; out.push(r); continue; }
        const { runProgram } = await import('../classic/client.mjs');
        const prog = parts.find(p => !p.includes('=')) || '';
        const res = await runProgram(e.base, prog, values, { pages: true });
        const text = `${res.message || ''}\n${res.list || ''}`;
        const rows = String(res.list || '').split('\n').filter(l => l.trim()).length;
        r.actual = [res.message, res.screen ? 'stays on the selection screen' : rows ? `${words(rows, 'list line')}` : ''].filter(Boolean).join('; ') || (res.ok ? 'ran' : 'failed');
        // an error case: the expected text in an error message is the expected result
        r.status = (res.ok || (t.expect && res.message && expectOk(t, res.message))) && expectOk(t, text) ? 'Pass' : 'Fail';
        // a default run of a report with mandatory fields: the selection screen asking for them is the expected result
        if (t.defaults && res.screen && /required|obligatory|fill in/i.test(res.message || '')) { r.status = 'Pass'; r.expected = 'selection screen checks the mandatory fields'; r.actual = res.message; }
        if (chrome && res.selection && !seenSelection.has(prog.toUpperCase())) {
          seenSelection.add(prog.toUpperCase());
          const img = shootHtml(chrome, res.selection, e.base, path.join(tmp, `${id}-sel.png`), tmp);
          if (img) shots.push({ img, caption: `Selection screen of ${prog.toUpperCase()}` });
        }
        const img = chrome && res.html ? shootHtml(chrome, res.html, e.base, path.join(tmp, `${id}.png`), tmp) : null;
        if (img) { shots.push({ img, caption: `${id}: ${r.title}` }); r.evidence = `Fig. ${shots.length}`; }
      } else if (kind === 'odata') {
        const [method = 'GET', rel = ''] = parts;
        const url = `http://localhost:${port}/a/${encodeURIComponent(app)}/odata/${rel.replace(/^\/?(odata\/)?/, '')}`;
        const res = await fetch(url, { method: method.toUpperCase(), headers: { Accept: 'application/json' } });
        const body = await res.text();
        let n = ''; try { const j = JSON.parse(body); n = Array.isArray(j.value) ? `, ${words(j.value.length, 'entry', 'entries')}` : ''; } catch {}
        r.actual = `HTTP ${res.status}${n}`;
        r.status = res.status < 400 && expectOk(t, body) ? 'Pass' : 'Fail';
      } else if (kind === 'class') {
        const res = spawnSync(process.execPath, [path.join(ROOT, 'bin', 'rap.js'), 'run', dir, parts[0] || ''], { encoding: 'utf8', timeout: 120000 });
        const text = `${res.stdout}${res.stderr}`;
        r.actual = firstLine(res.stdout) || firstLine(res.stderr) || `exit ${res.status}`;
        r.status = res.status === 0 && expectOk(t, text) ? 'Pass' : 'Fail';
      } else if (kind === 'ui') {
        const url = `http://localhost:${port}/a/${encodeURIComponent(app)}/${(parts[0] || '').replace(/^\//, '')}`;
        const ok = await fetch(url).then(x => x.ok).catch(() => false);
        r.actual = ok ? 'page opens' : 'the studio is not running';
        r.status = ok ? 'Pass' : 'Skipped';
        const img = ok ? screenshot(chrome, url, path.join(tmp, `${id}.png`), { tmp }) : null;
        if (img) { shots.push({ img, caption: `${id}: ${r.title}` }); r.evidence = `Fig. ${shots.length}`; }
      } else {
        r.actual = `unknown test kind "${kind}" (program, odata, class or ui)`;
        r.status = 'Skipped';
      }
      if (t.actual && r.status === 'Pass') r.actual = t.actual;
    } catch (err) { r.actual = String(err?.message || err).slice(0, 200); }
    log(`  ${r.status.padEnd(7)} ${id} ${r.title}`);
    out.push(r);
  }
  eng?.stop?.();
  return { results: out, shots };
}
// test cases when the agent did not describe any: every report with its defaults, the app's start page
function defaultTests(objs, hasRap) {
  const tests = objs.filter(o => o.kind === 'Program' && /^\s*REPORT\b/im.test(o.text)).map(o => ({ title: `Run ${o.name} with the default selection`, run: `program ${o.name}`, defaults: true }));
  if (hasRap) tests.push({ title: 'The app opens', run: 'ui' });
  return tests;
}

// ---------------------------------------------------------------- the documents
function header(doc, kind, id, meta) {
  doc.title(kind, meta.title);
  doc.table(['Item', 'Value'], [['Document', id], ['App', meta.app], ['Date', meta.date], ['Author', 'RAP Studio · AI agent'], ['Request', meta.request || '—'], ['Status', 'Delivered']], { widths: [4, 13] });
}

function techSpec(meta, d, objs, progs, atc, qa) {
  const doc = new Docx({ header: `RAP Studio · Technical Specification · ${meta.app}`, footer: `${meta.date} · confidential` });
  header(doc, 'Technical Specification', `TS-${meta.day}-${meta.app}`, meta);
  let n = 0;
  doc.heading(`${++n}. Purpose and scope`).para(d.summary || meta.request || 'See the request above.');
  if (d.requirements?.length) doc.heading(`${++n}. Requirements`).bullets(d.requirements);
  doc.heading(`${++n}. Objects`).table(['Object', 'Type', 'File', 'Lines', 'Description'],
    objs.map(o => [o.name, o.kind, o.file.replace(/^src\//, ''), String(o.lines), d.objects?.[o.name] || d.objects?.[o.name.toLowerCase()] || progs.get(o.name)?.title || '']), { widths: [3.6, 2.6, 5, 1.3, 4.5] });
  for (const [name, p] of progs) {
    if (p.fields.length) doc.heading(`${++n}. Selection screen of ${name}`).table(['Field', 'Kind', 'Reference', 'Text', 'Mandatory'], p.fields.map(f => [f.name, f.kind, f.type, f.text, f.mandatory ? 'yes' : '']), { widths: [2.6, 2.8, 4.2, 5.6, 1.8] });
  }
  if (d.design?.length) {
    doc.heading(`${++n}. Design`);
    for (const s of d.design) {
      if (s.heading) doc.heading(s.heading, 2);
      if (s.text) doc.para(s.text);
      if (s.bullets?.length) doc.bullets(s.bullets);
      if (s.code) doc.code(s.code);
    }
  }
  const tables = [...new Set([...progs.values()].flatMap(p => p.tables))].sort();
  if (tables.length) doc.heading(`${++n}. Data sources`).para(`Tables and views read: ${tables.join(', ')}.`);
  const auth = [...new Set([...progs.values()].flatMap(p => p.auth))];
  if (auth.length || d.authorization) doc.heading(`${++n}. Authorization`).para(d.authorization || `Authorization objects checked: ${auth.join(', ')}.`);
  if (d.limitations?.length) doc.heading(`${++n}. Limitations and open points`).bullets(d.limitations);
  doc.heading(`${++n}. Quality`).bullets([
    `Code checks (ATC, check variant ${atc.after.title || atc.after.variant}): ${atc.after.summary.error} errors, ${atc.after.summary.warning} warnings, ${atc.after.summary.info} infos${atc.fixed.fixed ? ` after ${words(atc.fixed.fixed, 'automatic fix', 'automatic fixes')}` : ''} (ATC Check Report).`,
    `Tests: ${qa.passed} of ${qa.results.length} passed${qa.failed ? `, ${qa.failed} failed` : ''} (QA Test Report).`]);
  return doc;
}

function qaReport(meta, d, qa, atc, activation) {
  const doc = new Docx({ header: `RAP Studio · QA Test Report · ${meta.app}`, footer: `${meta.date} · confidential` });
  header(doc, 'QA Test Report', `QA-${meta.day}-${meta.app}`, meta);
  doc.heading('1. Summary').table(['Area', 'Result'], [
    ['Activation', activation],
    ['Code checks (ATC)', `${atc.after.summary.error} errors, ${atc.after.summary.warning} warnings, ${atc.after.summary.info} infos`],
    ['Test cases', `${qa.passed} of ${qa.results.length} passed${qa.failed ? `, ${qa.failed} failed` : ''}${qa.skipped ? `, ${qa.skipped} skipped` : ''}`],
    ['Screenshots', qa.shots.length ? `${qa.shots.length} (section 4)` : qa.chrome ? 'none' : 'not taken: no Chrome found on the server (set RAP_CHROME)']], { widths: [5, 12] });
  doc.heading('2. Test cases').table(['ID', 'Test', 'Expected', 'Actual', 'Status', 'Evidence'],
    qa.results.map(r => [r.id, r.title, r.expected, r.actual, r.status, r.evidence]), { widths: [1.4, 4.4, 3.6, 4.4, 1.5, 1.7], status: 4 });
  doc.heading('3. How the tests ran').para('Each test case was run on the app in RAP Studio; the commands can be repeated in the app folder with rap:')
    .code(qa.results.map(r => `${r.id}  rap ${r.run}`).join('\n') || '—');
  if (d.notes?.length) doc.bullets(d.notes);
  doc.heading('4. Evidence');
  if (!qa.shots.length) doc.para('No screenshots.', { italic: true });
  qa.shots.forEach((s, i) => doc.image(s.img, `Figure ${i + 1}: ${s.caption}`));
  doc.heading('5. Sign-off').table(['Role', 'Name', 'Date', 'Result'], [['Developer', 'RAP Studio · AI agent', meta.date, qa.failed ? 'Delivered with open defects' : 'Delivered'], ['QA', '', '', ''], ['Approver', '', '', '']], { widths: [4, 5, 3, 5] });
  return doc;
}

function atcReport(meta, atc) {
  const doc = new Docx({ header: `RAP Studio · ATC Check Report · ${meta.app}`, footer: `${meta.date} · confidential` });
  header(doc, 'ATC Check Report', `ATC-${meta.day}-${meta.app}`, meta);
  const s = x => `${x.summary.error} errors, ${x.summary.warning} warnings, ${x.summary.info} infos`;
  doc.heading('1. Summary').table(['Item', 'Value'], [
    ['Check variant', `${atc.after.title || atc.after.variant} (${atc.after.variant})`], ['Sources checked', String(atc.after.files)],
    ['Before automatic fixes', s(atc.before)], ['Automatic fixes', atc.fixed.fixed ? `${atc.fixed.fixed} in ${atc.fixed.files.join(', ')}` : 'none needed'],
    ['Result', s(atc.after)], ['Exemptions', 'pragmas in the code (##…) only']], { widths: [5, 12] });
  const count = list => list.reduce((m, f) => m.set(f.rule, (m.get(f.rule) || 0) + 1), new Map());
  const b = count(atc.before.findings), a = count(atc.after.findings);
  const gone = [...b].filter(([r, c]) => (a.get(r) || 0) < c).map(([r, c]) => [r, String(c - (a.get(r) || 0))]);
  if (gone.length) doc.heading('2. Fixed automatically').table(['Check', 'Findings fixed'], gone, { widths: [12, 5] });
  doc.heading(`${gone.length ? 3 : 2}. Findings`);
  if (!atc.after.findings.length) doc.para('No findings.', { bold: true });
  else doc.table(['Severity', 'Location', 'Finding', 'Check'], atc.after.findings.map(f => [f.severity, `${f.file}:${f.line}`, f.message, f.rule]), { widths: [2, 4.5, 8, 2.5], status: 0 });
  return doc;
}

// ---------------------------------------------------------------- the whole delivery
export async function deliver(dir, { fix = true, describe = true, pdf = true, shots = true, log = console.log, port = Number(process.env.RAP_PORT || 4004) } = {}) {
  dir = path.resolve(dir);
  const app = process.env.RAP_APP || path.basename(dir);
  const appMeta = readJson(path.join(dir, '.rap', 'app.json')) || {};
  const d = (describe && readJson(path.join(dir, '.rap', 'delivery.json'))) || {};
  const now = new Date();
  const meta = { app, title: d.title || appMeta.title || app, request: d.request || appMeta.prompt || '', date: dmy(now), day: today(now).replace(/-/g, '') };
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rap-deliver-'));
  try {
    // code checks: quick fixes first, then the result
    const { Workspace } = await import('../server/server.js');
    const { runAtc, fixAtc } = await import('../check/atc.js');
    const ws = new Workspace(dir, { lint: false, dbFile: ':memory:' });
    const knownObjects = ws.knownObjects();
    const errors = ws.app.diagnostics.errors.length;
    ws.close();
    const before = runAtc(dir, { knownObjects });
    const fixed = fix && before.summary.fixable ? fixAtc(dir, { knownObjects }) : { fixed: 0, files: [] };
    const after = fixed.fixed ? runAtc(dir, { knownObjects }) : before;
    const atc = { before, fixed, after };
    log(`[rap] checks: ${after.summary.error} error(s), ${after.summary.warning} warning(s), ${after.summary.info} info(s)${fixed.fixed ? ` after ${fixed.fixed} automatic fix(es)` : ''}`);

    const objs = inventory(dir);
    const progs = new Map(objs.filter(o => o.kind === 'Program').map(o => [o.name, programInfo(dir, o)]));
    const hasRap = objs.some(o => o.kind === 'Service definition');
    const chrome = shots ? chromePath() : null;
    const tests = d.tests?.length ? d.tests : defaultTests(objs, hasRap);
    log(`[rap] ${words(tests.length, 'test case')}${chrome ? '' : ' (no Chrome found: no screenshots)'}`);
    const run = await runTests(dir, tests, { app, port, chrome, tmp, log });
    const qa = { ...run, chrome, passed: run.results.filter(r => r.status === 'Pass').length, failed: run.results.filter(r => r.status === 'Fail').length, skipped: run.results.filter(r => r.status === 'Skipped').length };

    const folder = path.join(dir, 'docs', `${today(now)}-${slug(d.topic || d.title || appMeta.title || app)}`);
    fs.mkdirSync(folder, { recursive: true });
    const activation = errors ? `${words(errors, 'error')} (rap check)` : '0 errors';
    const docs = [['Technical_Specification', techSpec(meta, d, objs, progs, atc, qa)], ['QA_Test_Report', qaReport(meta, d, qa, atc, activation)], ['ATC_Check_Report', atcReport(meta, atc)]];
    const files = [];
    for (const [name, doc] of docs) { fs.writeFileSync(path.join(folder, `${name}.docx`), doc.toBuffer()); files.push(`${name}.docx`); }
    // PDF copies when LibreOffice is there
    const soffice = ['/opt/homebrew/bin/soffice', '/usr/local/bin/soffice', '/usr/bin/soffice', '/Applications/LibreOffice.app/Contents/MacOS/soffice'].find(p => fs.existsSync(p));
    if (soffice && pdf) {
      spawnSync(soffice, ['--headless', `-env:UserInstallation=file://${path.join(tmp, 'lo')}`, '--convert-to', 'pdf', '--outdir', folder, ...docs.map(([n]) => path.join(folder, `${n}.docx`))], { timeout: 180000, stdio: 'ignore' });
      for (const [n] of docs) if (fs.existsSync(path.join(folder, `${n}.pdf`))) files.push(`${n}.pdf`);
    }
    const manifest = { created: now.toISOString(), title: meta.title, folder: path.relative(dir, folder), files: files.sort(),
      atc: { before: before.summary, after: after.summary, fixed: fixed.fixed, fixedFiles: fixed.files },
      tests: { total: qa.results.length, passed: qa.passed, failed: qa.failed, skipped: qa.skipped, screenshots: qa.shots.length },
      described: !!d.tests?.length || !!d.summary };
    fs.writeFileSync(path.join(folder, 'manifest.json'), JSON.stringify(manifest, null, 1));
    log(`[rap] deliverables in ${manifest.folder}: ${manifest.files.join(', ')}`);
    return manifest;
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

// the newest delivery of an app (manifest), or null
export function latestDelivery(dir) {
  const base = path.join(dir, 'docs');
  if (!fs.existsSync(base)) return null;
  return fs.readdirSync(base).map(f => readJson(path.join(base, f, 'manifest.json'))).filter(Boolean).sort((a, b) => String(b.created).localeCompare(String(a.created)))[0] || null;
}
