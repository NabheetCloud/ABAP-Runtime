#!/usr/bin/env node
// Conformance with real-world ABAP: the exercises of exercism's ABAP track (https://github.com/exercism/abap, MIT),
// each a reference solution with ABAP Unit tests, compiled and tested with RAP Studio's runtime (rap test).
//   node scripts/conformance-exercism.mjs [exercise ...] [--verbose]     (clones the track into vendor/exercism-abap)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TRACK = path.join(ROOT, 'vendor', 'exercism-abap');
if (!fs.existsSync(path.join(TRACK, 'config.json'))) (await import('../src/studio/exercises.js')).fetchTrack(TRACK);   // the tested commit
const verbose = process.argv.includes('--verbose');
const only = process.argv.slice(2).filter(a => !a.startsWith('--'));
const practice = path.join(TRACK, 'exercises', 'practice');
const results = [];
for (const ex of fs.readdirSync(practice).filter(d => !d.includes('.') && (!only.length || only.includes(d)))) {
  const dir = path.join(practice, ex);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `exercism-${ex}-`));
  fs.mkdirSync(path.join(tmp, 'src'));
  // the exercise's files, then the reference solution over the stub
  for (const f of fs.readdirSync(dir)) if (/\.(abap|xml)$/.test(f) && !f.endsWith('.devc.xml')) fs.copyFileSync(path.join(dir, f), path.join(tmp, 'src', f));
  for (const f of fs.readdirSync(path.join(dir, '.meta'))) if (/\.abap$/.test(f)) fs.copyFileSync(path.join(dir, '.meta', f), path.join(tmp, 'src', f));
  const r = spawnSync(process.execPath, [path.join(ROOT, 'bin', 'rap.js'), 'test', tmp, '--no-lint'], { encoding: 'utf8', timeout: 120000 });
  const out = `${r.stdout || ''}${r.stderr || ''}`;
  const m = /(\d+) passed, (\d+) failed, (\d+) errors/.exec(out);
  results.push({ ex, ok: r.status === 0, passed: m ? +m[1] : 0, total: m ? +m[1] + +m[2] + +m[3] : 0, out });
  fs.rmSync(tmp, { recursive: true, force: true });
}
for (const r of results) {
  console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.ex.padEnd(26)} ${r.total ? `${r.passed}/${r.total} tests` : r.out.split('\n').find(l => /ERROR/.test(l))?.trim().slice(0, 120) || ''}`);
  if (!r.ok && verbose) console.log(r.out.split('\n').filter(l => /FAIL|ERROR|expected|Error/i.test(l)).slice(0, 12).map(l => `      ${l.trim().slice(0, 200)}`).join('\n'));
}
const tests = results.reduce((a, r) => [a[0] + r.passed, a[1] + r.total], [0, 0]);
console.log(`\n${results.filter(r => r.ok).length}/${results.length} exercises pass, ${tests[0]}/${tests[1]} tests`);
