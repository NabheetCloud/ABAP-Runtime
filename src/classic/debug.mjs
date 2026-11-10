// Classic ABAP engine, debugger (host side). The transpiled code of the app has a hook in front of every statement
// (debugmap.mjs); while the debugger is active a hook asks whether to stop there. A stop pauses only that request:
// its promise waits for the next command while the engine keeps serving (the studio polls the state and sends
// step into / over / out, continue, stop). Jobs and requests that are not dialog steps of a program never stop.
//   globalThis.__rapDbg = { on, at(id, scope, self) }
import { AsyncLocalStorage } from 'node:async_hooks';
import fs from 'node:fs';
import path from 'node:path';

export class DebugStop extends Error { constructor() { super('The program was stopped in the debugger'); this.rapDebugStop = true; } }

export function installDebugger(abap, work) {
  let map = { hooks: [], lines: {}, files: {} };
  try { map = JSON.parse(fs.readFileSync(path.join(work, 'debug-map.json'), 'utf8')); } catch {}
  // per transpiled file: the hooks' JavaScript lines, sorted (a stack frame's line -> the statement it runs)
  const byFile = Object.fromEntries(Object.entries(map.files || {}).map(([f, ids]) => [f, Object.entries(ids).map(([id, l]) => [l, Number(id)]).sort((a, b) => a[0] - b[0])]));
  const als = new AsyncLocalStorage();
  const dbg = { on: false };
  let breakpoints = new Set(), requested = [], first = false, paused = null, resume = null, running = 0, last = null, seq = 0;
  // watches: expressions shown at every stop; watchpoints (stop) stop where the value changes (and the condition holds)
  let watches = [];
  const lastWatch = new Map();

  // breakpoint 'src/x.prog.abap:188' -> the hooks of the statement on that line; on a line without one (a
  // declaration, WHEN, ELSE, a comment) the next statement of the same block (FORM, method, module, event), never
  // one of another block. bound: where each breakpoint stops (null: nowhere, shown as not bound)
  let bound = {};
  function resolve(list) {
    const ids = new Set();
    bound = {};
    for (const bp of list) {
      const i = bp.lastIndexOf(':');
      const file = bp.slice(0, i), line = Number(bp.slice(i + 1)), lines = map.lines?.[file];
      bound[bp] = null;
      if (!lines || !line) continue;
      const at = l => { for (const id of lines[l]) ids.add(id); bound[bp] = l; };
      if (lines[line]) { at(line); continue; }
      const st = map.stmts?.[file];
      if (!st) { for (let l = line; l <= line + 25; l++) if (lines[l]) { at(l); break; } continue; }
      // the statement on the line, or the next one after a blank or comment line
      let k = st.findIndex(s => s[0] <= line && line <= s[1]);
      if (k < 0) k = st.findIndex(s => s[0] > line);
      if (k < 0) continue;
      const block = st[k][2];
      for (; k < st.length && st[k][2] === block; k++) if (lines[st[k][0]]) { at(st[k][0]); break; }
    }
    return ids;
  }
  // the ABAP call stack from the JavaScript one: every frame in instrumented code is the statement it is running
  function stack(trace = new Error().stack) {
    const frames = [];
    for (const l of String(trace).split('\n')) {
      const m = /[/\\]([^/\\]+\.mjs):(\d+):\d+\)?\s*$/.exec(l);
      const hooks = m && byFile[m[1]];
      if (!hooks) continue;
      const line = Number(m[2]);
      let lo = 0, hi = hooks.length - 1, hit = -1;
      while (lo <= hi) { const mid = (lo + hi) >> 1; if (hooks[mid][0] <= line) { hit = mid; lo = mid + 1; } else hi = mid - 1; }
      if (hit < 0) continue;
      // only a hook of the frame's own method (a method without statements of the app, e.g. the converter's
      // dispatcher, is no ABAP frame)
      const starts = map.methods?.[m[1]];
      if (starts?.length) { const begin = starts.filter(x => x <= line).pop() ?? 0; if (hooks[hit][0] < begin) continue; }
      const h = map.hooks[hooks[hit][1]];
      if (h) frames.push({ label: h.block || h.file, file: h.file, line: h.line });
    }
    return frames;
  }

  dbg.at = async function (id, scope, self) {
    const ctx = als.getStore();
    if (!ctx || paused) return;   // not a dialog step of a program, or another one has stopped already
    let stop = breakpoints.has(id) || ctx.mode === 'into', frames, reason = null;
    let getters = null;
    const gettersOf = () => { if (!getters) { try { getters = scope() || {}; } catch { getters = {}; } } return getters; };
    // a watch set in a method belongs to that method; globals of the program are watched everywhere
    const block = map.hooks[id]?.block || '';
    const inFrame = w => !w.frame || w.frame === block || !/->|^FORM |^METHOD /.test(w.frame);
    for (const w of watches) {
      if (!w.stop || !inFrame(w)) continue;
      const loc = evaluate(w.expr, gettersOf(), self);
      if (!loc) continue;
      const v = view(loc.get(), 1), k = JSON.stringify(v), was = lastWatch.get(w.expr);
      lastWatch.set(w.expr, k);
      if (was !== undefined && was !== k && cond(w.cond, v.v)) { stop = true; reason = { kind: 'watchpoint', expr: w.expr, cond: w.cond || '', old: JSON.parse(was), value: v }; }
    }
    if (!stop && (ctx.mode === 'over' || ctx.mode === 'out')) {
      frames = stack();
      stop = ctx.mode === 'over' ? frames.length <= ctx.depth : frames.length < ctx.depth;
    }
    if (!stop) return;
    first = false;   // "Debug" without breakpoints: this was the first statement of the program that ran
    frames ||= stack();
    const h = map.hooks[id] || {};
    const snapshot = () => {
      const vars = {};
      let me = null, meLabel = '';
      for (const [n, g] of Object.entries(gettersOf())) {
        let v;
        try { v = g(); } catch { vars[n] = { t: 'unassigned' }; continue; }
        if (n === 'io_session') continue;   // the converter's dialog session, not a variable of the program
        if (n === 'io_owner') { me = globals(v); meLabel = 'Program globals'; continue; }
        vars[n] = view(v);
      }
      if (!me && self && typeof self === 'object') {
        // an event or FORM of a converted program runs in the owner object: its attributes are the global data
        if (/\.prog\.abap$/.test(h.file || '') && !/->/.test(h.block || '')) { me = globals(self); meLabel = 'Program globals'; }
        else me = objectView(self, 1);
      }
      const wl = watches.map(w => { const loc = evaluate(w.expr, gettersOf(), self); let v = { t: 'unassigned' }; try { if (loc) v = view(loc.get()); } catch {} return { expr: w.expr, stop: !!w.stop, cond: w.cond || '', value: v, found: !!loc }; });
      return { file: h.file, line: h.line, stack: frames.map(f => f.label), frames, vars, me, meLabel, sy: syView(), watches: wl, reason, seq: ++seq };
    };
    ctx.stops++;
    paused = snapshot();
    // a changed value (set) or new watches: the same stop, shown again
    current = { snapshot, locate: expr => locate(expr, gettersOf(), self), remember: () => { for (const w of watches) { const l = evaluate(w.expr, gettersOf(), self); if (l) lastWatch.set(w.expr, JSON.stringify(view(l.get(), 1))); } } };
    const cmd = await new Promise(r => { resume = r; });
    paused = null; resume = null; current = null;
    if (cmd === 'stop') { ctx.mode = 'run'; throw new DebugStop(); }
    ctx.mode = cmd === 'continue' ? 'run' : cmd;
    ctx.depth = frames.length;
  };

  function syView() {
    const sy = abap.builtin.sy.get();
    return Object.fromEntries(['subrc', 'tabix', 'index', 'dbcnt', 'uname', 'datum', 'uzeit', 'cprog', 'ucomm', 'msgid', 'msgno', 'msgty', 'msgv1'].filter(k => sy[k]).map(k => [k, view(sy[k])]));
  }
  // the owner object of a converted program: its attributes are the program's global data (mv_x -> x)
  function globals(v) {
    const o = v?.constructor?.name === 'ABAPObject' ? v.get() : v;
    if (!o || typeof o !== 'object') return null;
    const src = o.FRIENDS_ACCESS_INSTANCE || o;
    const comps = {};
    for (const [k, x] of Object.entries(src)) {
      if (!x || typeof x !== 'object' || typeof x.get !== 'function' || k === 'me' || k.startsWith('$')) continue;
      comps[k.replace(/^m[vstor]_/, '')] = view(x, 1);
      if (Object.keys(comps).length >= 100) break;
    }
    return { t: 'object', cls: 'PROGRAM', comps };
  }

  dbg.configure = ({ active, breakpoints: list, first: f, watches: wl } = {}) => {
    if (list) { requested = list; breakpoints = resolve(list); }
    if (wl) watches = wl;
    if (f !== undefined) first = !!f;
    if (active !== undefined) {
      dbg.on = !!active;
      if (!active) { first = false; if (resume) resume('continue'); }
    }
    return dbg.state();
  };
  let current = null;
  dbg.command = (cmd, extra = {}) => {
    if (cmd === 'watches') { watches = extra.watches || []; current?.remember(); if (current) paused = { ...current.snapshot(), reason: paused?.reason || null }; return dbg.state(); }
    if (cmd === 'set' && current) {
      const loc = current.locate(extra.expr);
      if (loc) { try { setValue(loc.get(), extra.value); } catch (e) { paused = { ...paused, error: e.message }; return dbg.state(); } }
      current.remember();
      paused = { ...current.snapshot(), reason: paused?.reason || null };
      return dbg.state();
    }
    if (resume && ['into', 'over', 'out', 'continue', 'stop'].includes(cmd)) resume(cmd);
    return dbg.state();
  };
  dbg.state = () => ({ active: dbg.on, status: paused ? 'paused' : running ? 'running' : 'armed', paused, breakpoints: requested, resolved: breakpoints.size, bound, last, hooks: map.hooks.length });
  // a dialog step of a program: it may stop (after "Debug" without breakpoints, at the first statement of the
  // program that runs: a selection screen without INITIALIZATION code has none)
  dbg.request = async (label, fn) => {
    if (!dbg.on) return fn();
    const ctx = { mode: first ? 'into' : 'run', depth: 0, stops: 0, label };
    running++;
    try { return await als.run(ctx, fn); }
    finally {
      running--;
      if (ctx.stops) last = { label, at: Date.now() };
    }
  };
  // the ABAP frames of an error (a runtime error of a dialog step): innermost first, { label, file, line }
  dbg.framesOf = e => { try { return stack(e?.stack); } catch { return []; } };
  globalThis.__rapDbg = dbg;
  return dbg;
}

// a value of the variables view (same shape as the RAP debugger's): elementary values as they are, structures,
// tables and objects with their first components
export function view(v, level = 2) {
  if (v === undefined || v === null) return { t: 'unassigned' };
  if (typeof v !== 'object') return typeof v === 'number' ? { t: 'num', v } : { t: 'text', v: String(v) };
  const kind = v.constructor?.name;
  try {
    switch (kind) {
      case 'FieldSymbol': { const p = v.getPointer(); return p ? view(p, level) : { t: 'unassigned' }; }
      case 'DataReference': { const p = v.getPointer(); return p ? { t: 'struct', comps: level > 0 ? { '->*': view(p, level - 1) } : undefined } : { t: 'ref', v: 'initial' }; }
      case 'ABAPObject': { const o = v.get(); return o ? objectView(o, level) : { t: 'ref', v: 'initial' }; }
      case 'Structure': { const c = v.get(); return { t: 'struct', comps: level > 0 ? Object.fromEntries(Object.entries(c).slice(0, 100).map(([k, x]) => [k, view(x, level - 1)])) : undefined }; }
      case 'Table': case 'HashedTable': { const a = v.array(); return { t: 'table', lines: a.length, rows: level > 0 ? a.slice(0, 100).map(x => view(x, level - 1)) : undefined }; }
      case 'Integer': case 'Integer8': case 'Float': case 'Packed': case 'DecFloat34': { const x = v.get(); return { t: 'num', v: typeof x === 'bigint' ? String(x) : x }; }
      default: {
        if (typeof v.get !== 'function') return objectView(v, level);
        const x = v.get();
        const s = typeof x === 'string' ? x : String(x ?? '');
        return { t: 'text', v: s.length > 500 ? `${s.slice(0, 500)}…` : s, len: s.length };
      }
    }
  } catch { return { t: 'unassigned' }; }
}
function objectView(o, level) {
  const cls = String(o.constructor?.INTERNAL_NAME || o.constructor?.name || 'object').replace(/^PROG-[^-]+-/, '').toUpperCase();
  if (level <= 0) return { t: 'object', cls };
  const comps = {};
  for (const src of [o, o.FRIENDS_ACCESS_INSTANCE].filter(Boolean)) {
    for (const [k, x] of Object.entries(src)) {
      if (!x || typeof x !== 'object' || typeof x.get !== 'function' || k === 'me' || k.startsWith('$') || k in comps) continue;
      comps[k] = view(x, level - 1);
      if (Object.keys(comps).length >= 60) break;
    }
  }
  return { t: 'object', cls, comps };
}

// a watch expression: a data object (locate) or a built-in function of one: lines( itab ), strlen( s ),
// xstrlen( x ), to_upper / to_lower( s ), condense( s ), abs( n ), boolc( x ) / xsdbool( x ) (initial check)
const FUNCS = {
  lines: v => (typeof v?.array === 'function' ? v.array().length : 0),
  strlen: v => String(v?.get?.() ?? '').replace(/ +$/, '').length,
  xstrlen: v => String(v?.get?.() ?? '').length / 2,
  to_upper: v => String(v?.get?.() ?? '').toUpperCase(),
  to_lower: v => String(v?.get?.() ?? '').toLowerCase(),
  condense: v => String(v?.get?.() ?? '').trim().replace(/\s+/g, ' '),
  abs: v => Math.abs(Number(v?.get?.() ?? 0)),
};
function evaluate(expr, getters, self) {
  const f = /^\s*([a-z_]+)\(\s*(.+?)\s*\)\s*$/i.exec(String(expr || ''));
  const fn = f && FUNCS[f[1].toLowerCase()];
  if (!fn) return locate(expr, getters, self);
  const inner = locate(f[2], getters, self);
  if (!inner) return null;
  const deref = v => (['FieldSymbol', 'DataReference'].includes(v?.constructor?.name) ? v.getPointer() : v);
  return { get: () => fn(deref(inner.get())), computed: true };
}

// an expression (lv_x, ls_s-comp, lt_t[2]-comp, me->attr, a program global) -> { get } of the open-abap value
function locate(expr, getters, self) {
  const toks = String(expr || '').trim().toLowerCase().match(/->|[a-z_%$][\w%$/]*|\[\d+\]|-/g);
  if (!toks?.length) return null;
  const deref = v => (v?.constructor?.name === 'FieldSymbol' ? v.getPointer() : v?.constructor?.name === 'DataReference' ? v.getPointer() : v);
  const attr = (o, name) => {
    const obj = o?.constructor?.name === 'ABAPObject' ? o.get() : o;
    if (!obj || typeof obj !== 'object') return undefined;
    for (const src of [obj, obj.FRIENDS_ACCESS_INSTANCE].filter(Boolean)) {
      const k = Object.keys(src).find(x => x.toLowerCase() === name || x.toLowerCase().replace(/^m[vstor]_/, '') === name);
      if (k !== undefined) return src[k];
    }
    return undefined;
  };
  let i = 0, get;
  const first = toks[i++];
  if (first === 'me' && toks[i] === '->') { i++; const a = toks[i++]; get = () => attr(self, a); }
  else {
    const g = Object.entries(getters).find(([k]) => k.toLowerCase() === first)?.[1];
    if (g) get = g;
    else {
      // a global of a converted program (the owner object's attributes)
      const owner = getters.io_owner?.() || self;
      if (attr(owner, first) === undefined) return null;
      get = () => attr(owner, first);
    }
  }
  while (i < toks.length) {
    const t = toks[i++], parent = get;
    if (t === '-' || t === '->') { const comp = toks[i++]; get = () => { const v = deref(parent()); if (v?.constructor?.name === 'Structure') { const c = v.get(); const k = Object.keys(c).find(x => x.toLowerCase() === comp); return k === undefined ? undefined : c[k]; } return attr(v, comp); }; }
    else if (/^\[\d+\]$/.test(t)) { const n = Number(t.slice(1, -1)) - 1; get = () => { const v = deref(parent()); return typeof v?.array === 'function' ? v.array()[n] : undefined; }; }
  }
  try { if (get() === undefined) return null; } catch { return null; }
  return { get };
}
// a value typed in the debugger into an open-abap value (its own conversion: numbers, dates, texts)
function setValue(target, value) {
  const t = target?.constructor?.name === 'FieldSymbol' ? target.getPointer() : target;
  if (!t || typeof t.set !== 'function' || ['Structure', 'Table', 'HashedTable', 'ABAPObject'].includes(t.constructor?.name)) throw new Error('Only elementary values can be changed');
  const k = t.constructor?.name;
  t.set(['Integer', 'Integer8', 'Float', 'Packed', 'DecFloat34'].includes(k) && !Number.isNaN(Number(value)) ? Number(value) : String(value));
}
function cond(c, v) {
  const m = /^\s*(<>|>=|<=|=|>|<|ne|eq|gt|lt|ge|le)\s*'?(.*?)'?\s*$/i.exec(String(c || ''));
  if (!m) return true;
  const op = { ne: '<>', eq: '=', gt: '>', lt: '<', ge: '>=', le: '<=' }[m[1].toLowerCase()] || m[1];
  const num = m[2] !== '' && !Number.isNaN(Number(m[2])) && !Number.isNaN(Number(v));
  const a = num ? Number(v) : String(v ?? '').trim(), b = num ? Number(m[2]) : m[2];
  return op === '=' ? a === b : op === '<>' ? a !== b : op === '>' ? a > b : op === '<' ? a < b : op === '>=' ? a >= b : a <= b;
}
