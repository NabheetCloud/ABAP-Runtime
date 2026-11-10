// The debugger's worker: activates the app with debug builds (every statement can stop) and runs a console class or
// the unit tests. At a stop it posts the position, the ABAP call stack and the variables to the studio and waits
// for a command (continue, step into / over / out, stop) — the worker blocks, the studio stays responsive.
//   workerData: { dir, dbFile, systemDir, kind: 'class' | 'tests', name, filter, breakpoints: ['src/x.clas.abap:12', ...] }
import { parentPort, workerData, receiveMessageOnPort } from 'node:worker_threads';
import { DEBUG } from '../abap/compiler.js';
import { Workspace } from './server.js';

DEBUG.on = true;
const STOP = Symbol('stop');
let stopped = false;
const sleep = new Int32Array(new SharedArrayBuffer(4));
let breakpoints = new Set(workerData.breakpoints || []);
const waiting = [];   // OData requests that arrived while the debugger was stopped (kind rap)
let mode = breakpoints.size ? 'run' : 'into', depth = 0;   // without breakpoints: stop at the first statement

const ws = new Workspace(workerData.dir, { lint: false, systemDir: workerData.systemDir, ...(workerData.dbFile ? { dbFile: workerData.dbFile } : {}) });
const rt = ws.app.rt;
rt.sqlTrace = !!workerData.trace;   // the SQL trace of the app also covers what runs in the debugger

// a value for the variables view: elementary values as they are, tables and structures and objects with their
// first components (deeper levels on request: inspect)
function view(v, level = 2) {
  if (v === undefined) return { t: 'unassigned' };
  if (v === null) return { t: 'ref', v: 'initial' };
  if (typeof v === 'number') return { t: 'num', v };
  if (typeof v === 'string') return { t: 'text', v: v.length > 500 ? `${v.slice(0, 500)}…` : v, len: v.length };
  if (typeof v === 'boolean') return { t: 'text', v: v ? 'X' : '' };
  if (Array.isArray(v)) return { t: 'table', lines: v.length, rows: level > 0 ? v.slice(0, 100).map(x => view(x, level - 1)) : undefined };
  if (typeof v === 'function') return { t: 'class', v: String(v.$name || '').toUpperCase() };
  const cls = v.constructor?.$name;
  const entries = Object.entries(v).filter(([k]) => !k.startsWith('$') && !k.startsWith('%'));
  if (cls && cls !== 'object') return { t: 'object', cls: String(cls).toUpperCase(), comps: level > 0 ? Object.fromEntries(entries.slice(0, 60).map(([k, x]) => [k, view(x, level - 1)])) : undefined };
  return { t: 'struct', comps: level > 0 ? Object.fromEntries(entries.slice(0, 100).map(([k, x]) => [k, view(x, level - 1)])) : undefined };
}
const syView = () => Object.fromEntries(['subrc', 'tabix', 'index', 'dbcnt', 'uname', 'datum', 'uzeit', 'msgid', 'msgno', 'msgty', 'msgv1'].map(k => [k, view(rt.sy[k])]));

// watches (like the ABAP debugger's): expressions (lv_x, ls_s-comp, lt_t[2]-comp, me->attr) shown at every stop;
// a watchpoint (stop) stops where its value changes (optionally only when the condition holds: > 100, = 'X', <> 0)
let watches = workerData.watches || [];
const ABSENT = '\u0000absent';
const isInitial = v => v === undefined || v === null || v === '' || v === 0 || v === false || (Array.isArray(v) && !v.length);
const initialOf = v => (Array.isArray(v) ? [] : typeof v === 'number' ? 0 : typeof v === 'string' ? '' : v && typeof v === 'object' ? {} : null);
const lastWatch = new Map();
const lc = o => (o && typeof o === 'object' && !Array.isArray(o) ? Object.fromEntries(Object.entries(o).map(([k, v]) => [k.toLowerCase(), v])) : o);
// an expression -> { get, set } in the frame's variables (pairs: name -> [get, set]) and the instance (self)
function locate(expr, pairs, self) {
  const toks = String(expr || '').trim().toLowerCase().match(/->|[a-z_%$][\w%$/]*|\[\d+\]|-/g);
  if (!toks?.length) return null;
  let i = 0, get, set;
  const first = toks[i++];
  const pairOf = n => Object.entries(pairs).find(([k]) => k.toLowerCase() === n)?.[1];
  if (first === 'me' && toks[i] === '->') { i++; const a = toks[i++]; const key = self && Object.keys(self).find(k => k.toLowerCase() === a); if (!key) return null; get = () => self[key]; set = v => { self[key] = v; }; }
  else {
    const p = pairOf(first);
    if (p) { [get, set] = p; }
    else { const key = self && typeof self === 'object' && Object.keys(self).find(k => k.toLowerCase() === first); if (!key) return null; get = () => self[key]; set = v => { self[key] = v; }; }
  }
  while (i < toks.length) {
    const t = toks[i++];
    const parent = get;
    if (t === '-' || t === '->') {
      const comp = toks[i++];
      const keyOf = () => { const o = parent(); return o && typeof o === 'object' ? Object.keys(o).find(k => k.toLowerCase() === comp) : undefined; };
      get = () => { const o = parent(); const k = keyOf(); return k === undefined ? undefined : o[k]; };
      set = v => { const o = parent(); const k = keyOf() ?? comp; o[k] = v; };
    } else if (/^\[\d+\]$/.test(t)) {
      const n = Number(t.slice(1, -1)) - 1;
      get = () => parent()?.[n];
      set = v => { parent()[n] = v; };
    }
  }
  return { get, set };
}
// a value typed in the debugger -> the variable's type (numbers stay numbers; texts; X / space)
const convert = (old, v) => (typeof old === 'number' ? (Number.isNaN(Number(v)) ? old : Number(v)) : typeof old === 'boolean' ? /^(x|true|1)$/i.test(String(v)) : typeof old === 'bigint' ? BigInt(v) : String(v));
const key = v => { try { return JSON.stringify(v, (k, x) => (typeof x === 'bigint' ? String(x) : x)); } catch { return String(v); } };
function cond(c, v) {
  const m = /^\s*(<>|>=|<=|=|>|<|ne|eq|gt|lt|ge|le)\s*'?(.*?)'?\s*$/i.exec(String(c || ''));
  if (!m) return true;
  const op = { ne: '<>', eq: '=', gt: '>', lt: '<', ge: '>=', le: '<=' }[m[1].toLowerCase()] || m[1];
  const a = typeof v === 'number' || !Number.isNaN(Number(v)) && m[2] !== '' && !Number.isNaN(Number(m[2])) ? Number(v) : String(v ?? '').trim();
  const b = typeof a === 'number' ? Number(m[2]) : m[2];
  return op === '=' ? a === b : op === '<>' ? a !== b : op === '>' ? a > b : op === '<' ? a < b : op === '>=' ? a >= b : a <= b;
}

rt.dbg = (file, line, scope, self) => {
  const d = rt.callStack.length;
  const at = `${file}:${line}`;
  let stop = mode === 'into' || breakpoints.has(at) || (mode === 'over' && d <= depth) || (mode === 'out' && d < depth);
  let pairs = null, reason = null;
  const pairsOf = () => { if (!pairs) { try { pairs = scope() || {}; } catch { pairs = {}; } } return pairs; };
  // watchpoints: the value changed since the last statement (in a frame where the expression exists)
  const frame = rt.callStack.at(-1) || '';
  // a watch set in a method belongs to that method (its local variables), like in the ABAP debugger
  const inFrame = w => !w.frame || w.frame === frame || /^me->/i.test(w.expr);
  for (const w of watches) {
    if (!w.stop || !inFrame(w)) continue;
    const loc = locate(w.expr, pairsOf(), self);
    // not declared yet (an inline declaration further down): its first value counts as a change from initial
    if (!loc) { if (!lastWatch.has(w.expr)) lastWatch.set(w.expr, ABSENT); continue; }
    let v; try { v = loc.get(); } catch { continue; }
    let k = key(v), was = lastWatch.get(w.expr);
    if (was === ABSENT) was = isInitial(v) ? k : key(initialOf(v));
    lastWatch.set(w.expr, k);
    if (was !== undefined && was !== k && cond(w.cond, v)) { stop = true; reason = { kind: 'watchpoint', expr: w.expr, cond: w.cond || '', old: view(JSON.parse(was)), value: view(v) }; }
  }
  if (!stop) return;
  const send = () => {
    const vars = {};
    for (const [n, pr] of Object.entries(pairsOf())) { try { vars[n] = view(pr[0]()); } catch { vars[n] = { t: 'unassigned' }; } }
    const me = self && typeof self === 'object' ? view(self, 1) : null;
    const wl = watches.map(w => { const loc = inFrame(w) ? locate(w.expr, pairsOf(), self) : null; let v; try { v = loc?.get(); } catch {} return { expr: w.expr, stop: !!w.stop, cond: w.cond || '', value: loc ? view(v) : { t: 'unassigned' }, found: !!loc }; });
    parentPort.postMessage({ type: 'paused', file, line, stack: [...rt.callStack].reverse(), vars, me, sy: syView(), watches: wl, reason, seq: Date.now() });
  };
  send();
  for (;;) {
    Atomics.wait(sleep, 0, 0, 50);
    const m = receiveMessageOnPort(parentPort)?.message;
    if (!m) continue;
    if (m.type === 'odata') { waiting.push(m); continue; }   // another request of the app: after this one
    if (m.cmd === 'breakpoints') { breakpoints = new Set(m.breakpoints || []); continue; }
    if (m.cmd === 'watches') { watches = m.watches || []; for (const w of watches) { const loc = locate(w.expr, pairsOf(), self); try { if (loc) lastWatch.set(w.expr, key(loc.get())); } catch {} } send(); continue; }
    if (m.cmd === 'set') {   // change a variable (or a component / row of it) in this frame
      const loc = locate(m.expr, pairsOf(), self);
      if (loc) { try { loc.set(convert(loc.get(), m.value)); for (const w of watches) { const l2 = locate(w.expr, pairsOf(), self); try { if (l2) lastWatch.set(w.expr, key(l2.get())); } catch {} } } catch (e) { parentPort.postMessage({ type: 'error', message: e.message }); } }
      send();
      continue;
    }
    if (m.cmd === 'inspect') {   // a variable in full (a table's rows, an object's attributes), by name and path
      let v; try { v = pairsOf()[m.name]?.[0](); for (const k of m.path || []) v = v?.[k]; } catch {}
      parentPort.postMessage({ type: 'inspect', name: m.name, path: m.path || [], value: view(v, 3) });
      continue;
    }
    if (m.breakpoints) breakpoints = new Set(m.breakpoints);
    if (m.cmd === 'stop') { stopped = true; throw STOP; }
    mode = m.cmd === 'continue' ? 'run' : m.cmd;   // into | over | out
    depth = d;
    parentPort.postMessage({ type: 'running' });
    return;
  }
};

// a RAP app: the worker serves the app's OData requests (the preview's Fiori app) while breakpoints are set, so a
// click in the app stops in the behavior handler; one request at a time, the response goes back to the studio
if (workerData.kind === 'rap') {
  mode = 'run';
  const serve = m => {
    let r;
    try { r = m.op === 'batch' ? ws.odata.batch(...m.args) : ws.odata.handle(...m.args); }
    catch (e) {
      if (e === STOP) { parentPort.postMessage({ type: 'response', id: m.id, r: { status: 503, body: { error: { code: '503', message: 'The debugger was stopped' } } } }); parentPort.postMessage({ type: 'done', result: { stopped: true } }); ws.close(); process.exit(0); }
      if (process.env.RAP_DEBUG) console.error(e);
      r = { status: e.status || 500, body: { error: { code: String(e.status || 500), message: String(e?.message || e) } } };
    }
    mode = 'run';
    parentPort.postMessage({ type: 'response', id: m.id, r });
  };
  parentPort.on('message', m => {
    if (m.type === 'odata') { serve(m); while (waiting.length) serve(waiting.shift()); }
    else if (m.cmd === 'breakpoints') breakpoints = new Set(m.breakpoints || []);
    else if (m.cmd === 'watches') watches = m.watches || [];
    else if (m.cmd === 'stop') { parentPort.postMessage({ type: 'done', result: { stopped: true } }); ws.close(); process.exit(0); }
  });
  parentPort.postMessage({ type: 'armed' });
} else {
let result;
try {
  if (workerData.kind === 'tests') result = { kind: 'tests', ...ws.runTests(workerData.filter || '') };
  else result = { kind: 'class', ...ws.runClass(workerData.name) };
} catch (e) {
  result = e === STOP ? { stopped: true } : { error: String(e?.message || e) };
}
if (stopped) result = { stopped: true };
parentPort.postMessage({ type: 'done', result, trace: rt.sqlTraceLog || [] });
ws.close();
}
