// Practice ABAP: exercism's ABAP track in the studio (needs the track in vendor/exercism-abap: npm run conformance:exercism).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Exercises } from '../src/studio/exercises.js';

const skip = !fs.existsSync(new URL('../vendor/exercism-abap/config.json', import.meta.url)) && 'exercism track not downloaded (npm run conformance:exercism)';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rap-ex-'));
after(() => fs.rmSync(dir, { recursive: true, force: true }));

test('list by level, starter files, failing and passing tests, syntax errors, progress, reset', { skip, timeout: 120000 }, async () => {
  const x = new Exercises(dir);
  const l = x.list();
  assert.ok(l.exercises.length > 50 && !l.exercises.some(e => e.slug === 'minesweeper'));   // deprecated in the track
  assert.deepEqual(l.levels, ['Easy', 'Medium', 'Hard']);
  const o = x.open('leap');
  assert.deepEqual(o.files.map(f => f.role), ['solution', 'test']);
  assert.match(o.instructions, /leap year/i);
  assert.throws(() => x.save('leap', 'zcl_leap.clas.testclasses.abap', ''), /Only the solution file/);
  const sol = o.files[0];
  const first = await x.test('leap');
  assert.equal(first.ok, false);
  x.save('leap', sol.name, sol.text.replace('* add solution here', 'result = xsdbool( yaer MOD 4 = 0 ).'));
  const typo = await x.test('leap');
  assert.deepEqual(typo.syntax.map(s => s.line), [13]);
  x.save('leap', sol.name, sol.text.replace('* add solution here', 'result = xsdbool( year MOD 4 = 0 AND ( year MOD 100 <> 0 OR year MOD 400 = 0 ) ).'));
  const ok = await x.test('leap');
  assert.equal(ok.ok, true);
  assert.equal(ok.passed, ok.total);
  assert.equal(x.list().done, 1);
  x.save('leap', sol.name, sol.text);                       // a later failing attempt keeps it solved
  await x.test('leap');
  assert.equal(x.progress().leap.status, 'passed');
  x.save('leap', sol.name, sol.text.replace('* add solution here', 'DO. ENDDO.'));
  const loop = await x.test('leap', { timeoutMs: 3000 });
  assert.match(loop.errors[0].message, /endless loop/);
  assert.match(x.reset('leap').files[0].text, /add solution here/);
  assert.equal(x.list().done, 0);
  assert.match(x.example('leap').files[0].text, /METHOD leap/);
});
