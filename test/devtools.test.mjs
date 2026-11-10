// Developer tools: runtime errors (the uncaught exception with the ABAP call stack and source), the SQL trace and
// the debugger (breakpoints, stepping, variables, call stack; a worker that stops at statements).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Workspace } from '../src/server/server.js';
import { getDump, listDumps } from '../src/server/dumps.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rap-devtools-'));
fs.cpSync(new URL('./fixtures/devtools', import.meta.url).pathname, dir, { recursive: true });
const ws = new Workspace(dir, { lint: false, systemDir: false });
after(() => { ws.close(); fs.rmSync(dir, { recursive: true, force: true }); });
const FILE = 'src/zcl_dev_demo.clas.abap';

test('runtime error: exception, the failing statement, the ABAP call stack and the source', () => {
  const r = ws.runClass('zcl_dev_demo');
  assert.equal(r.ok, false);
  const d = getDump(ws, r.dump);
  assert.equal(d.exception, 'CX_SY_ZERODIVIDE');
  assert.equal(d.context, 'Console ZCL_DEV_DEMO');
  assert.deepEqual([d.file, d.line], [FILE, 18]);
  assert.deepEqual(d.frames.map(f => [f.method, f.line]), [['divide', 18], ['if_oo_adt_classrun~main', 12]]);
  assert.match(d.source.find(x => x.line === 18).text, /r = tmp \/ b\./);
  assert.equal(listDumps(ws)[0].id, r.dump);
});

test('SQL trace: statements with time, rows and the ABAP method; off again', () => {
  ws.app.rt.sqlTrace = true;
  ws.runClass('zcl_dev_demo');
  ws.app.rt.sqlTrace = false;
  const sel = (ws.app.rt.sqlTraceLog || []).find(r => /FROM\s+"?zdev_item/i.test(r.sql));
  assert.ok(sel, 'the SELECT is traced');
  assert.equal(sel.rows, 2);
  assert.deepEqual(sel.params, [1]);
  assert.equal(sel.abap, 'ZCL_DEV_DEMO MAIN');
  const n = ws.app.rt.sqlTraceLog.length;
  ws.runClass('zcl_dev_demo');
  assert.equal(ws.app.rt.sqlTraceLog.length, n);
});

const until = async (want, ms = 15000) => {
  for (const t0 = Date.now(); Date.now() - t0 < ms;) { const s = ws.debugState(); if (want.includes(s.status)) return s; await new Promise(r => setTimeout(r, 30)); }
  return ws.debugState();
};
test('debugger: stops at a breakpoint, steps into a method, shows variables and the call stack, steps out, stops', { timeout: 30000 }, async () => {
  ws.debugStart({ kind: 'class', name: 'zcl_dev_demo', breakpoints: [`${FILE}:12`] });
  let s = await until(['paused', 'done']);
  assert.equal(s.status, 'paused');
  assert.deepEqual([s.paused.file, s.paused.line], [FILE, 12]);
  assert.equal(s.paused.vars.count.v, 2);
  assert.equal(s.paused.vars.items.t, 'table');
  assert.equal(s.paused.vars.items.rows[1].comps.name.v, 'Pear');
  ws.debugCommand('into');
  s = await until(['paused', 'done']);
  assert.deepEqual([s.paused.line, s.paused.stack], [17, ['ZCL_DEV_DEMO DIVIDE', 'ZCL_DEV_DEMO MAIN']]);
  assert.equal(s.paused.vars.a.v, 2);
  ws.debugCommand('over');
  s = await until(['paused', 'done']);
  assert.deepEqual([s.paused.line, s.paused.vars.tmp.v], [18, 20]);
  ws.debugCommand('stop');
  s = await until(['done']);
  assert.deepEqual(s.result, { stopped: true });
});

test('debugger: without breakpoints it stops at the first statement; continue runs to the end', { timeout: 30000 }, async () => {
  ws.debugStart({ kind: 'class', name: 'zcl_dev_demo' });
  let s = await until(['paused', 'done']);
  assert.equal(s.paused.line, 9);
  ws.debugCommand('continue');
  s = await until(['done']);
  assert.equal(s.result.ok, false);
  assert.match(s.result.error, /CX_SY_ZERODIVIDE/);
});

test('debugger: change values (a variable, a cell of a table); the program goes on with them', { timeout: 30000 }, async () => {
  ws.debugStart({ kind: 'class', name: 'zcl_dev_demo', breakpoints: [`${FILE}:12`] });
  let s = await until(['paused', 'done']);
  assert.equal(s.paused.vars.count.v, 2);
  ws.debugCommand('set', { expr: 'count', value: '5' });
  s = await until2(x => x.paused?.vars.count.v === 5);
  assert.equal(s.paused.line, 12);                                   // still the same stop
  ws.debugCommand('set', { expr: 'items[1]-name', value: 'Kiwi' });
  s = await until2(x => x.paused?.vars.items.rows[0].comps.name.v === 'Kiwi');
  ws.debugCommand('into');
  s = await until2(x => x.paused?.line === 17);
  assert.equal(s.paused.vars.a.v, 5);                                // divide( a = count ): the changed value
  ws.debugCommand('stop');
  await until(['done']);
});

test('debugger: watches show values at every stop; a watchpoint stops where the value changes', { timeout: 30000 }, async () => {
  ws.debugStart({ kind: 'class', name: 'zcl_dev_demo', breakpoints: [`${FILE}:11`], watches: [{ expr: 'count', stop: false }, { expr: 'items[2]-name' }, { expr: 'tmp', stop: true }] });
  let s = await until(['paused', 'done']);
  assert.equal(s.paused.line, 11);
  const w = Object.fromEntries(s.paused.watches.map(x => [x.expr, x]));
  assert.equal(w.count.value.v, 2);
  assert.equal(w['items[2]-name'].value.v, 'Pear');
  assert.equal(w.tmp.found, false);                                  // not in this frame
  ws.debugCommand('continue');
  s = await until2(x => x.status === 'paused' && x.paused?.reason);
  assert.equal(s.paused.reason.kind, 'watchpoint');
  assert.equal(s.paused.reason.expr, 'tmp');
  assert.deepEqual([s.paused.reason.old.v, s.paused.reason.value.v], [0, 20]);
  assert.equal(s.paused.line, 18);                                   // after tmp = a * 10
  ws.debugCommand('stop');
  await until(['done']);
  // a condition that does not hold: no stop
  ws.debugStart({ kind: 'class', name: 'zcl_dev_demo', breakpoints: [], watches: [{ expr: 'tmp', stop: true, cond: '> 100' }] });
  s = await until(['paused', 'done']);
  ws.debugCommand('continue');
  s = await until(['done']);
  assert.match(s.result.error, /CX_SY_ZERODIVIDE/);
});
const until2 = async (pred, ms = 15000) => {
  for (const t0 = Date.now(); Date.now() - t0 < ms;) { const s = ws.debugState(); if (pred(s)) return s; await new Promise(r => setTimeout(r, 30)); }
  return ws.debugState();
};

test('debugger: a watchpoint on a variable declared inline further down stops where it gets its first value', { timeout: 30000 }, async () => {
  ws.debugStart({ kind: 'class', name: 'zcl_dev_demo', breakpoints: [], watches: [{ expr: 'count', stop: true, frame: 'ZCL_DEV_DEMO MAIN' }] });
  let s = await until(['paused', 'done']);
  assert.equal(s.paused.line, 9);                                    // the first statement: count is not declared yet
  ws.debugCommand('continue');
  s = await until2(x => x.status === 'paused' && x.paused?.reason);
  assert.equal(s.paused.reason.expr, 'count');
  assert.deepEqual([s.paused.reason.old.v, s.paused.reason.value.v], [0, 2]);
  assert.equal(s.paused.line, 11);
  ws.debugCommand('stop');
  await until(['done']);
});
