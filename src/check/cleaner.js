// SAP's ABAP cleaner (https://github.com/SAP/abap-cleaner, Apache-2.0), fetched by `npm run setup:abap-cleaner` into
// vendor/abap-cleaner: its command line cleans ABAP sources (100 rules: declarations, alignment, obsolete syntax,
// pretty printing, ...) with its default profile, or the profile in knowledge/abap-cleaner/profile.cfj when present.
// It runs on the Java runtime bundled with the stand-alone build.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const VENDOR = path.join(ROOT, 'vendor', 'abap-cleaner');
const PROFILE = path.join(ROOT, 'knowledge', 'abap-cleaner', 'profile.cfj');

// the plugins folder (ABAP cleaner jars and the bundled JRE) of the stand-alone build
function plugins() {
  const stack = [VENDOR];
  while (stack.length) {
    const d = stack.pop();
    let entries = [];
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { continue; }
    if (path.basename(d) === 'plugins' && entries.some(e => /^com\.sap\.adt\.abapcleaner_.*\.jar$/.test(e.name))) return d;
    for (const e of entries) if (e.isDirectory() && !e.name.startsWith('org.eclipse.justj')) stack.push(path.join(d, e.name));
  }
  return null;
}
let located;
function locate() {
  if (located !== undefined) return located;
  const p = plugins();
  const jre = p && fs.readdirSync(p).find(n => n.startsWith('org.eclipse.justj.openjdk'));
  const java = jre && path.join(p, jre, 'jre', 'bin', process.platform === 'win32' ? 'java.exe' : 'java');
  located = java && fs.existsSync(java) ? { java, plugins: p, version: (() => { try { return fs.readFileSync(path.join(VENDOR, 'VERSION'), 'utf8').trim(); } catch { return ''; } })() } : null;
  return located;
}
export function cleanerAvailable() { return locate(); }

function run(args) {
  const c = locate();
  if (!c) throw Object.assign(new Error('ABAP cleaner is not installed: npm run setup:abap-cleaner'), { status: 400 });
  const profile = fs.existsSync(PROFILE) ? ['--profile', PROFILE] : [];
  const r = spawnSync(c.java, ['-cp', path.join(c.plugins, '*'), 'com.sap.adt.abapcleaner.gui.FrmMain', ...args, ...profile, '--stats'],
    { encoding: 'utf8', timeout: 120000, maxBuffer: 32 << 20 });
  if (r.status !== 0) throw new Error(`ABAP cleaner failed: ${(r.stderr || r.stdout || r.error?.message || '').trim().slice(0, 500)}`);
  return (r.stdout || '').trim();
}

const hash = s => crypto.createHash('sha1').update(s).digest('hex');
const ABAP = /\.abap$/i;

// cleans ABAP files in place; returns { files: changed relative paths, before: {path: text}, stats }
export function clean(dir, { file } = {}) {
  const targets = file ? [path.resolve(dir, file)] : listAbap(path.join(dir, 'src'));
  const before = new Map(targets.filter(f => ABAP.test(f) && fs.existsSync(f)).map(f => [f, fs.readFileSync(f, 'utf8')]));
  if (!before.size) return { files: [], before: {}, stats: 'No ABAP sources' };
  let stats = '';
  if (file) stats = run(['--sourcefile', [...before.keys()][0], '--targetfile', [...before.keys()][0], '--overwrite']);
  else stats = run(['--sourcedir', path.join(dir, 'src'), '--filepattern', '*.abap', '--recursive', '--targetdir', path.join(dir, 'src'), '--overwrite']);
  const changed = [...before].filter(([f, t]) => hash(fs.readFileSync(f, 'utf8')) !== hash(t)).map(([f]) => f);
  return { files: changed.map(f => path.relative(dir, f)), before: Object.fromEntries([...before].filter(([f]) => changed.includes(f)).map(([f, t]) => [path.relative(dir, f), t])), stats: stats.split('\n').find(l => /rules applied|changed/i.test(l)) || stats.split('\n')[0] || '' };
}
// cleans ABAP code given as text (the editor's "Clean up")
export function cleanSource(code) {
  const out = run(['--source', code]);
  // the command line prints the statistics line, a blank line, then the cleaned code
  const i = out.indexOf('\n\n');
  return { stats: i > 0 ? out.slice(0, i).trim() : '', code: i > 0 ? out.slice(i + 2) : out };
}
export function restore(dir, before) { for (const [rel, text] of Object.entries(before)) fs.writeFileSync(path.join(dir, rel), text); }

function listAbap(d) {
  const out = [];
  for (const e of fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }) : []) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) out.push(...listAbap(p)); else if (ABAP.test(e.name)) out.push(p);
  }
  return out;
}
