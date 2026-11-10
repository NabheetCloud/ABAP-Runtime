#!/usr/bin/env node
// Conformance with SAP's ABAP cheat sheets (https://github.com/SAP-samples/abap-cheat-sheets, Apache-2.0): the
// repository is activated as one app and every class with IF_OO_ADT_CLASSRUN is run to the end (rap run), as in ADT
// with F9. A class passes when it finishes without an exception; its output is not compared.
//   node scripts/conformance-cheatsheets.mjs [class ...] [--verbose]      (clones the repository into vendor/)
// To see how far a class gets: RAP_TRACE_OUT=1 node bin/rap.js run vendor/abap-cheat-sheets <class> --no-lint
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO = path.join(ROOT, 'vendor', 'abap-cheat-sheets');
if (!fs.existsSync(REPO)) execFileSync('git', ['clone', '-q', '--depth', '1', 'https://github.com/SAP-samples/abap-cheat-sheets.git', REPO], { stdio: 'inherit' });
const verbose = process.argv.includes('--verbose');
const only = process.argv.slice(2).filter(a => !a.startsWith('--')).map(a => a.toLowerCase());
const src = path.join(REPO, 'src');
const classes = fs.readdirSync(src).filter(f => /\.clas\.abap$/.test(f) && /^\s*INTERFACES:?\s+if_oo_adt_classrun\b/im.test(fs.readFileSync(path.join(src, f), 'utf8')))
  .map(f => f.split('.')[0]).filter(c => !only.length || only.includes(c));

// each class in its own process, with a time and memory limit (a runaway loop fails that class only)
const run = cls => new Promise(resolve => {
  const p = spawn(process.execPath, ['--max-old-space-size=1024', path.join(ROOT, 'bin', 'rap.js'), 'run', REPO, cls, '--no-lint'], { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, RAP_DB: 'sqlite:memory' } });   // a database per run
  let out = '';
  p.stdout.on('data', d => { out += d; });
  p.stderr.on('data', d => { out += d; });
  const timer = setTimeout(() => p.kill('SIGKILL'), 90000);
  p.on('close', code => { clearTimeout(timer); resolve({ cls, ok: code === 0, killed: p.signalCode === 'SIGKILL', oom: /heap out of memory/.test(out), out }); });
});
const results = [];
for (let i = 0; i < classes.length; i += 6) results.push(...await Promise.all(classes.slice(i, i + 6).map(run)));
const reason = r => r.killed ? 'did not finish within 90 s' : r.oom ? 'out of memory (runaway loop?)'
  : (r.out.split('\n').filter(l => /^[A-Z_][A-Z0-9_/]*: |^Error|ERROR/.test(l.trim()) && !/^\s*ERROR\s+src\//.test(l)).pop() || r.out.trim().split('\n').pop() || '').trim().slice(0, 160);
for (const r of results) {
  console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.cls.padEnd(40)} ${r.ok ? '' : reason(r)}`);
  if (!r.ok && verbose) console.log(r.out.split('\n').slice(-15).map(l => `      ${l.slice(0, 200)}`).join('\n'));
}
console.log(`\n${results.filter(r => r.ok).length}/${results.length} cheat-sheet classes run to the end`);
process.exit(0);
