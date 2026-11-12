// Runtime library used by compiled ABAP code ($rt).
// One instance per activated workspace. `eml` and `sql` are attached by the RAP runtime.
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const TAG = '$e'; // hidden property: name of the RAP entity a row belongs to (for %tky)

import { authorityCheck } from '../server/auth.js';
import { runXslt, parseXml, isSimpleTransformation, stSerialize, stDeserialize } from './xslt.js';
import { DDIC_TABLE_TYPES, DDIC_STRUCTURES } from './ddic-types.js';
import { installCloudApis, installBackground } from './cloud-apis.js';
import { installFormApis } from './forms-apis.js';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export class AbapRuntime {
  RESUME = Symbol('resume');
  constructor() {
    this.classes = new Map();     // name -> materialised JS class
    this.factories = new Map();   // name -> { superName, factory, file }
    this.interfaces = new Map();
    this.output = [];
    this.logs = [];
    this.model = null;            // set by activation (entity metadata)
    this.messages = {};           // message classes: { zmsg: { '001': 'text &1' } }
    this.sy = makeSy();
    this.f = makeBuiltins(this);
    installBuiltinClasses(this);
  }

  // ------------------------------------------------------------------ class system
  defineClass(name, superName, factory, file) {
    this.factories.set(name, { superName, factory, file });
    this.classes.delete(name);
  }
  defineInterface(name, init) {
    const I = class {};
    I.$name = name; I.$isInterface = true;
    init(I);
    this.interfaces.set(name, I);
  }
  cls(name) {
    name = name.toLowerCase();
    if (this.classes.has(name)) return this.classes.get(name);
    if (this.interfaces.has(name)) return this.interfaces.get(name);
    const f = this.factories.get(name);
    if (!f) throw this.new('cx_sy_create_object_error', { text: `Class or interface ${name.toUpperCase()} does not exist` });
    const Base = f.superName === 'object' ? this.classes.get('object') : this.cls(f.superName);
    const C = f.factory(Base);
    C.$name = name;
    this.classes.set(name, C);
    if (typeof C.class_constructor === 'function') C.class_constructor({});
    return C;
  }
  hasClass(name) { return this.classes.has(name) || this.factories.has(name) || this.interfaces.has(name); }
  new(name, args = {}) {
    const C = this.cls(name);
    const obj = new C();
    if (typeof obj.$constructor === 'function') obj.$constructor(args);
    return obj;
  }
  isA(obj, name) {
    name = name.toLowerCase();
    if (obj == null) return false;
    if (!(obj instanceof this.classes.get('object')) && !(obj instanceof this.classes.get('cx_root'))) {
      // native JS error: behaves like a dynamic check exception
      return ['cx_root', 'cx_dynamic_check', 'cx_no_check', 'cx_sy_no_handler'].includes(name);
    }
    if (!this.hasClass(name)) return false;
    const C = this.cls(name);
    if (C.$isInterface) {
      for (let c = obj.constructor; c; c = Object.getPrototypeOf(c)) if (c.$meta?.interfaces?.includes(name)) return true;
      return false;
    }
    return obj instanceof C;
  }
  isControl() { return false; }
  // resumable exceptions: CATCH BEFORE UNWIND handlers run at the RAISE; RESUME continues after it
  pushHandlers(hs) { (this.resumeHandlers ||= []).push(...hs); }
  popHandlers(n) { this.resumeHandlers.length -= n; }
  handlerFor(id, e) { const h = (this.resumeHandlers || []).find(x => x.id === id); if (h) h.fn(e); }
  raiseResumable(e) {
    e.is_resumable = 'X';
    const hs = this.resumeHandlers || [];
    for (let k = hs.length - 1; k >= 0; k--) {
      const h = hs[k];
      if (!h.names.some(n => this.isA(e, n))) continue;
      if (h.fn(e) === this.RESUME) { e.is_resumable = 'X'; return; }
      e.$unwound = h.id;
      throw e;
    }
    throw e;
  }
  wrapErr(e) {
    if (e instanceof this.classes.get('cx_root')) return e;
    const w = this.new('cx_sy_no_handler', { text: e?.message || String(e) });
    w.native = e;
    return w;
  }
  throw_(e) { throw e; }
  // authorizations of the current user ({ OBJECT: [{ FIELD: [values] }] }, null = all); set per request
  authorityCheck(object, fields, user) {
    const auths = user && this.authStore ? this.authStore.authorizationsOf(this.s(user)) : this.auth;
    return authorityCheck(auths ?? null, this.s(object), Object.fromEntries(Object.entries(fields).map(([k, v]) => [this.s(k), v === undefined ? undefined : this.s(v).replace(/ +$/, '')])));
  }

  // method dispatch: $p = { name: value, $0: positional }
  call(obj, name, args = {}) {
    if (obj == null) throw this.new('cx_sy_ref_is_initial', { text: `Method ${name.toUpperCase()} called on initial reference` });
    const key = name === 'constructor' ? '$constructor' : name;
    let fn = obj[key];
    if (typeof fn !== 'function') {
      const k = findMethodKey(obj, key) || (obj.constructor && findMethodKey(obj.constructor, key));
      if (k && typeof obj[k] === 'function') fn = obj[k];
      else if (k && typeof obj.constructor[k] === 'function') { return obj.constructor[k](args) || {}; }
      else if (typeof obj.constructor?.[key] === 'function') return obj.constructor[key](args) || {};
    }
    if (typeof fn !== 'function') {
      const cname = obj.$name || obj.constructor?.$name || 'object';
      throw this.new('cx_sy_dyn_call_illegal_method', { text: `Method ${name.toUpperCase()} does not exist in ${cname.toUpperCase()}` });
    }
    // the call stack (XCO call_stack): "CLASS METHOD" of the methods running now
    const cs = CALL_STACK;
    cs.push(`${String(obj.$name || obj.constructor?.$name || 'object').toUpperCase()} ${name.toUpperCase()}`);
    try { return fn.call(obj, args) || {}; } finally { cs.pop(); }
  }
  get callStack() { return CALL_STACK; }
  fcall(obj, name, args) { return this.call(obj, name, args).$ret; }
  // CALL METHOD ... PARAMETER-TABLE ptab: rows { name, kind (E/I/C/R from the caller's view), value (REF #( dobj )) }.
  // Results reach the caller through the referenced table or structure (filled in place).
  callDynamic(obj, name, ptab) {
    const args = {};
    for (const p of ptab || []) if (['E', 'C'].includes(this.s(p.kind).toUpperCase())) args[this.s(p.name).toLowerCase()] = this.deref(p.value);
    const out = this.call(obj, name, args);
    for (const p of ptab || []) {
      const k = this.s(p.kind).toUpperCase();
      if (!['I', 'C', 'R'].includes(k)) continue;
      const v = k === 'R' ? out.$ret : out[this.s(p.name).toLowerCase()];
      if (p.value instanceof DataRef) { this.setDeref(p.value, v); continue; }
      if (Array.isArray(p.value) && Array.isArray(v)) { p.value.length = 0; p.value.push(...clone(v)); }
      else if (p.value && typeof p.value === 'object' && v && typeof v === 'object') Object.assign(p.value, clone(v));
    }
    return out;
  }

  // dynamic name lookup (attributes inherited from classes in other files, global constants)
  // database cursors: the selected rows, read in packages (sy-dbcnt counts what was fetched so far)
  openCursor(rows) { this.$cursors ||= new Map(); const id = (this.$cursorId = (this.$cursorId || 0) + 1); this.$cursors.set(id, { rows, pos: 0 }); this.sy.subrc = 0; return id; }
  fetchCursor(id, n) {
    const c = this.$cursors?.get(this.n(id));
    if (!c) throw this.new('cx_sy_open_sql_db', { text: 'The cursor is not open' });
    const part = c.rows.slice(c.pos, n > 0 ? c.pos + n : undefined);
    c.pos += part.length;
    this.sy.dbcnt = c.pos; this.sy.subrc = part.length ? 0 : 4;
    return part;
  }
  closeCursor(id) { this.$cursors?.delete(this.n(id)); }
  // datasets: files below <app>/.rap/files (names cannot leave that folder)
  datasetPath(name) {
    const base = path.join(this.appDir || process.cwd(), '.rap', 'files');
    const p = path.resolve(base, this.s(name).trim().replace(/^[/\\]+/, ''));
    if (!p.startsWith(base)) throw this.new('cx_sy_file_authority', { text: `No access to ${this.s(name)}` });
    return p;
  }
  datasetOpen(name, mode, binary) {
    const p = this.datasetPath(name);
    this.$datasets ||= new Map();
    try {
      if (mode === 'input') { const data = fs.readFileSync(p); this.$datasets.set(p, { mode, binary, lines: binary ? null : data.toString('utf8').split(/\r?\n/), data, pos: 0 }); }
      else { fs.mkdirSync(path.dirname(p), { recursive: true }); if (mode === 'output') fs.writeFileSync(p, ''); this.$datasets.set(p, { mode, binary }); }
      this.sy.subrc = 0;
    } catch { this.sy.subrc = 8; }
  }
  datasetWrite(name, v, noEnd) {
    const p = this.datasetPath(name), d = this.$datasets?.get(p);
    if (!d) throw this.new('cx_sy_file_open_mode', { text: `File ${this.s(name)} is not open` });
    fs.appendFileSync(p, d.binary ? Buffer.from(this.s(v), 'hex') : `${this.s(v)}${noEnd ? '' : '\n'}`);
  }
  datasetRead(name) {
    const d = this.$datasets?.get(this.datasetPath(name));
    if (!d) throw this.new('cx_sy_file_open_mode', { text: `File ${this.s(name)} is not open` });
    if (d.binary) { if (d.pos) { this.sy.subrc = 4; return null; } d.pos = 1; this.sy.subrc = 0; return d.data.toString('hex').toUpperCase(); }
    // the last line of a file that ends with a line break is not a line
    if (d.pos >= d.lines.length || (d.pos === d.lines.length - 1 && d.lines[d.pos] === '')) { this.sy.subrc = 4; return null; }
    this.sy.subrc = 0;
    return d.lines[d.pos++];
  }
  datasetClose(name) { this.$datasets?.delete(this.datasetPath(name)); }
  datasetDelete(name) { try { fs.unlinkSync(this.datasetPath(name)); this.sy.subrc = 0; } catch { this.sy.subrc = 4; } }
  // reports and transactions run on the app's classic engine (selection screens, lists, dynpros): a synchronous
  // bridge (src/classic/bridge.mjs) for SUBMIT ... AND RETURN and CALL TRANSACTION ... USING from ABAP code here
  classic(req) {
    const info = this.classicInfo?.() || { appDir: this.appDir };
    const what = `${req.kind === 'program' ? 'SUBMIT' : 'CALL TRANSACTION'} ${req.name}`;
    if (info.memory) throw this.new('cx_sy_dyn_call_illegal_func', { text: `${what}: reports and transactions need the app database on disk (SQLite file)` });
    let out;
    try {
      out = execFileSync(process.execPath, [fileURLToPath(new URL('../classic/bridge.mjs', import.meta.url))], { input: JSON.stringify({ ...info, ...req }), encoding: 'utf8', timeout: 180000, maxBuffer: 32 << 20 });
    } catch (e) { throw this.new('cx_sy_dyn_call_illegal_func', { text: `${what}: ${e.message.slice(0, 300)}` }); }
    const r = JSON.parse(out || '{}');
    if (!r.ok) throw this.new('cx_sy_dyn_call_illegal_func', { text: `${what}: ${r.error}` });
    return r.result;
  }
  // SUBMIT report WITH ... [EXPORTING LIST TO MEMORY] AND RETURN; values: { P_X: v, S_Y-LOW: a, S_Y-HIGH: b }
  submit(name, values, selTable, toMemory) {
    const vals = { ...values };
    for (const r of selTable || []) {
      const n = this.s(r.selname).trim().toUpperCase();
      if (this.s(r.kind).toUpperCase() === 'S') { vals[`${n}-LOW`] = this.s(r.low); if (this.s(r.high).trim()) vals[`${n}-HIGH`] = this.s(r.high); }
      else vals[n] = this.s(r.low);
    }
    const res = this.classic({ kind: 'program', name: this.s(name).trim().toUpperCase(), values: vals });
    const lines = String(res.list || '').split('\n');
    if (toMemory) this.abapMemory.set('%_LIST', lines);
    if (res.message) { this.sy.msgty = res.ok ? 'S' : 'E'; this.sy.msgv1 = res.message.slice(0, 50); }
    this.sy.subrc = res.ok && !res.screen ? 0 : 4;
    return res;
  }
  // CALL TRANSACTION tcode USING bdc_tab MESSAGES INTO msgs: each screen of the batch input table (a DYNBEGIN line,
  // its field values, BDC_OKCODE) is one step; returns the messages (BDCMSGCOLL); sy-subrc 1001 when a step failed
  callTransaction(tcode, bdc) {
    const steps = [];
    let cur = null;
    for (const r of bdc || []) {
      if (this.s(r.dynbegin).trim() === 'X') { cur = { program: this.s(r.program).trim().toUpperCase(), dynpro: this.s(r.dynpro).trim(), fields: {}, command: 'ENTER' }; steps.push(cur); continue; }
      if (!cur) continue;
      const f = this.s(r.fnam).trim().toUpperCase(), v = this.s(r.fval);
      if (f === 'BDC_OKCODE') { const c = v.trim().replace(/^[=/]/, '').toUpperCase(); cur.command = !c || c === '00' ? 'ENTER' : c; }
      else if (f !== 'BDC_CURSOR' && f !== 'BDC_SUBSCR') cur.fields[f] = v;
    }
    const tc = this.s(tcode).trim().toUpperCase();
    const snaps = this.classic({ kind: 'transaction', name: tc, steps: steps.map(s => ({ command: s.command, fields: s.fields })) });
    const msgs = snaps.map((s, k) => [s, steps[Math.max(0, k - 1)]]).filter(([s]) => s.message).map(([s, step]) => ({ ...DDIC_STRUCTURES.bdcmsgcoll, tcode: tc, dyname: step?.program || '', dynumb: step?.dynpro || '',
      msgtyp: s.ok ? 'S' : 'E', msgspra: 'E', msgv1: s.message.slice(0, 50), msgv2: s.message.slice(50, 100), msgv3: s.message.slice(100, 150), msgv4: s.message.slice(150, 200) }));
    this.sy.subrc = snaps.some(s => !s.ok) ? 1001 : 0;
    if (msgs.length) { this.sy.msgty = msgs.at(-1).msgtyp; this.sy.msgv1 = msgs.at(-1).msgv1; }
    return msgs;
  }
  // standard function modules for what SUBMIT ... EXPORTING LIST TO MEMORY kept
  builtinFunction(fm, args) {
    switch (fm) {
      case 'LIST_FROM_MEMORY': { const l = this.abapMemory.get('%_LIST'); if (!l) throw this.classicException('not_found'); return { listobject: l.map(x => ({ rfcsize: x.length, rfcrecord: x })) }; }
      case 'LIST_TO_ASCI': { const src = args.listobject || []; return { listasci: src.map(r => (typeof r === 'object' ? this.s(r.rfcrecord) : this.s(r))), listobject: src }; }
      case 'LIST_FREE_MEMORY': this.abapMemory.delete('%_LIST'); return {};
    }
    return null;
  }
  // CALL FUNCTION: the function modules of the app's function groups (each group is a class); a few standard ones
  callFunction(name, args) {
    const fm = this.s(name).trim().toUpperCase();
    const builtin = this.functions?.has(fm) ? null : this.formFunction?.(fm, args || {}) ?? this.lockFunction?.(fm, args || {}) ?? this.builtinFunction(fm, args || {});
    if (builtin) return builtin;
    const cls = this.functions?.get(fm);
    if (!cls) throw this.new('cx_sy_dyn_call_illegal_func', { text: `Function module ${fm} does not exist` });
    return this.call(this.cls(cls), fm.toLowerCase(), args);
  }
  // the SAP LUW: CALL FUNCTION ... IN UPDATE TASK and PERFORM ... ON COMMIT run at COMMIT WORK, ROLLBACK WORK drops them
  onCommit(fn) { (this.$luw ||= []).push(fn); }
  commitWork() { const todo = this.$luw || []; this.$luw = []; for (const fn of todo) fn(); this.sy.subrc = 0; this.$commitDone = true; }
  rollbackWork() { this.$luw = []; this.bgpfRollback?.(); }
  // classic exceptions of methods (RAISE name, EXCEPTIONS name = n | OTHERS = n at the call)
  classicException(name) { return Object.assign(new Error(`Exception ${name.toUpperCase()}`), { $classic: name.toLowerCase() }); }
  classicSubrc(e, map) {
    if (!e?.$classic) return null;
    if (e.$classic in map) return this.n(map[e.$classic]);
    return 'others' in map ? this.n(map.others) : null;
  }
  // an inherited attribute assigned: on the instance, or on the class in the hierarchy that declares it (static)
  setg(self, name, v) {
    if (self && typeof self === 'object' && name in self) { self[name] = v; return; }
    for (let C = typeof self === 'function' ? self : self?.constructor; C; C = Object.getPrototypeOf(C)) if (Object.prototype.hasOwnProperty.call(C, name)) { C[name] = v; return; }
    throw new ReferenceError(`Unknown data object '${name.toUpperCase()}'`);
  }
  g(self, name) {
    if (self && name in self) return self[name];
    if (self?.constructor && name in self.constructor) return self.constructor[name];
    if (typeof self === 'function' && name in self) return self[name];
    throw new ReferenceError(`Unknown data object '${name.toUpperCase()}'`);
  }

  // ------------------------------------------------------------------ values
  clone(v) { return clone(v); }
  tag(row, entity) { if (row && typeof row === 'object') Object.defineProperty(row, TAG, { value: entity, enumerable: false, writable: true, configurable: true }); return row; }
  entityOf(row) { return row?.[TAG]; }
  tky(obj) {
    if (!obj || typeof obj !== 'object') return {};
    let entity = obj[TAG];
    if (!entity && this.model) entity = this.model.guessEntity(obj);
    const keys = entity && this.model ? this.model.keysOf(entity) : null;
    if (!keys) return {};
    const out = {};
    for (const k of keys) out[k] = obj[k];
    if (this.model.draftEnabled?.(entity)) out['%is_draft'] = obj['%is_draft'] === '01' ? '01' : '00';
    return this.tag(out, entity);
  }
  n(v) {
    if (typeof v === 'number') return v;
    if (v === undefined || v === null || v === '' || v === true || v === false) return v === true ? 1 : 0;
    if (typeof v === 'string') {
      const s = v.trim();
      if (s === '') return 0;
      // mathematical (sign left, may be separated by blanks), commercial (sign right) or scientific notation
      const x = Number(s.endsWith('-') ? '-' + s.slice(0, -1).trim() : s.endsWith('+') ? s.slice(0, -1).trim() : /^[+-]\s/.test(s) ? s[0] + s.slice(1).trim() : s);
      if (Number.isNaN(x)) throw this.new('cx_sy_conversion_no_number', { text: `Unable to interpret '${v}' as a number` });
      return x;
    }
    if (typeof v === 'object') throw this.new('cx_sy_conversion_no_number', { text: 'Structure or table used as a number' });
    return Number(v);
  }
  s(v) {
    if (v === undefined || v === null) return '';
    if (typeof v === 'number') return fmtNumber(v);
    if (typeof v === 'object') return JSON.stringify(v);
    return String(v);
  }
  arith(op, a, b, ct) {
    const x = this.n(a), y = this.n(b);
    if (ct === 'f') {   // binary floating point: no decimal rounding
      if ((op === '/' || op === 'DIV' || op === 'MOD') && y === 0) { if (x === 0) return 0; throw this.new('cx_sy_zerodivide', { text: 'Division by zero' }); }
      switch (op) { case '+': return x + y; case '-': return x - y; case '*': return x * y; case '/': return x / y; case '**': return x ** y; }
    }
    if (ct === 'i' || ct === 'int8') {   // integer calculation: every intermediate result is an integer in the type's range
      const r = op === '/' ? (y === 0 ? this.arith(op, x, y) : round(this.round(x / y, 0))) : op === '**' ? x ** y : this.arith(op, x, y);
      if (ct === 'i' ? r > 2147483647 || r < -2147483648 : Math.abs(r) > 9223372036854775807) throw this.new('cx_sy_arithmetic_overflow', { text: `Overflow in the arithmetic operation ${x} ${op} ${y}` });
      return r;
    }
    switch (op) {
      case '+': return round(x + y);
      case '-': return round(x - y);
      case '*': return round(x * y);
      case '/': if (y === 0) { if (x === 0) return 0; throw this.new('cx_sy_zerodivide', { text: 'Division by zero' }); } return round(x / y);
      case 'DIV': if (y === 0) { if (x === 0) return 0; throw this.new('cx_sy_zerodivide', { text: 'Division by zero' }); } return Math.floor(x / y) + (x % y !== 0 && y < 0 ? 1 : 0);
      case 'MOD': { if (y === 0) { if (x === 0) return 0; throw this.new('cx_sy_zerodivide', { text: 'Division by zero' }); } const r = x - Math.abs(y) * Math.floor(x / Math.abs(y)); return round(r); }
      case '**': return x ** y;
    }
    throw new Error('Unknown operator ' + op);
  }
  eq(a, b) { return this.cmp(a, b) === 0; }
  // a float compared with a decimal number by their exact values (0.815 as f is 0.81499999999999994...)
  cmpExact(f, d) {
    const x = this.n(f), y = this.n(d);
    if (!Number.isFinite(x) || Math.abs(x) >= 1e21 || Math.abs(y) >= 1e21) return x < y ? -1 : x > y ? 1 : 0;
    const dec = str => { const neg = str.startsWith('-'); const [i, fr = ''] = str.replace('-', '').split('.'); return { neg, i, fr }; };
    const fx = dec(x.toFixed(100).replace(/0+$/, '').replace(/\.$/, '')), dy = dec(fmtNumber(y).includes('E') ? y.toFixed(40) : String(y));
    const len = Math.max(fx.fr.length, dy.fr.length);
    const big = v => (v.neg ? -1n : 1n) * BigInt(v.i + v.fr.padEnd(len, '0'));
    const a = big(fx), b = big(dy);
    return a < b ? -1 : a > b ? 1 : 0;
  }
  cmp(a, b) {
    if (a && typeof a === 'object' || b && typeof b === 'object') return deepEqual(a, b, this) ? 0 : 1;
    if (a === undefined || a === null) a = typeof b === 'number' ? 0 : '';
    if (b === undefined || b === null) b = typeof a === 'number' ? 0 : '';
    if (typeof a === 'number' || typeof b === 'number') {
      const x = toNumLoose(a), y = toNumLoose(b);
      if (x !== null && y !== null) return x < y ? -1 : x > y ? 1 : 0;
    }
    const x = String(a).replace(/ +$/, ''), y = String(b).replace(/ +$/, '');
    return x < y ? -1 : x > y ? 1 : 0;
  }
  // data references
  ref(get, set) { return new DataRef(get, set); }
  newRef(value) { let box = value; return new DataRef(() => box, v => { box = v; }); }
  rowRef(tab, i) { return new DataRef(() => tab[i], v => { tab[i] = v; }); }
  deref(x) { return x instanceof DataRef ? x.get() : x; }
  setDeref(x, v) {
    if (!(x instanceof DataRef)) throw this.new('cx_sy_ref_is_initial', { text: 'Dereferencing the initial reference' });
    const cur = x.get();
    // structures and tables keep their identity (other references and field symbols see the change)
    if (cur && typeof cur === 'object' && v && typeof v === 'object' && Array.isArray(cur) === Array.isArray(v) && !(cur instanceof DataRef)) this.fsAssign(cur, v);
    else x.set(clone(v));
  }
  initial(v) {
    if (v === undefined || v === null || v === '' || v === 0 || v === false) return true;
    if (v instanceof DataRef) return false;
    if (typeof v === 'string') return /^ *$/.test(v);
    if (Array.isArray(v)) return v.length === 0;
    if (typeof v === 'object') {
      if (v instanceof this.classes.get('object') || v instanceof this.classes.get('cx_root')) return false;
      return Object.values(v).every(x => this.initial(x));
    }
    return false;
  }
  // d, t, n: all zeros (or blanks) is the initial value
  initialDigits(v) { return v === undefined || v === null || v === 0 || (typeof v === 'string' && /^[0 ]*$/.test(v)); }
  initialOf(v) {
    if (Array.isArray(v)) { const a = []; for (const m of ['$line', '$sort']) if (v[m]) Object.defineProperty(a, m, { value: v[m], enumerable: false }); return a; }
    if (v && typeof v === 'object') {
      if (v instanceof this.classes.get('object') || v instanceof this.classes.get('cx_root')) return null;
      const o = {};
      for (const [k, x] of Object.entries(v)) o[k] = this.initialOf(x);
      return o;
    }
    if (typeof v === 'number') return 0;
    if (v === null) return null;
    return '';
  }
  lineOf(tab) { return Array.isArray(tab) && tab.length ? this.initialOf(tab[0]) : {}; }
  initLine(tab) { return tab?.$line ? tab.$line() : this.lineOf(tab); }
  // an internal table that knows the initial value of its line type (APPEND INITIAL LINE, VALUE #( ) lines)
  // an integer converted to a string: its digits and the sign position ("99 ", "5-")
  istr(v) { return typeof v === 'number' && Number.isInteger(v) ? `${Math.abs(v)}${v < 0 ? '-' : ' '}` : v; }
  // a table with its line type ($line) and, for a SORTED table type, its key ($sort)
  newTab(line, sort) { const a = []; Object.defineProperty(a, '$line', { value: line, enumerable: false }); if (sort) Object.defineProperty(a, '$sort', { value: sort, enumerable: false }); return a; }
  // ABAP rounds half away from zero (commercial rounding)
  round(x, dec = 0) {
    const a = Math.abs(x);
    if (!Number.isFinite(a) || a >= 2 ** 52) return x;
    // shift by the exponent in the number's text, so 2.675 rounds to 2.68 (not 2.67 as 2.675 * 100 would)
    const r = dec ? Number(`${Math.round(Number(`${a}e${dec}`))}e-${dec}`) : Math.round(a);
    return x < 0 ? -r : r;
  }
  // conversion into an elementary target type (assignment, RETURNING, MOVE): i/int8 and p round, a number of
  // seconds becomes a time (HHMMSS, modulo one day), a number of days a date (since 0001-01-01)
  conv(type, dec, v) {
    if (v === null || v === undefined) return v;
    const numeric = typeof v === 'number' || (typeof v === 'string' && v.trim() !== '' && /^[+-]?\d*\.?\d+(E[+-]?\d+)?-?$/i.test(v.trim()));
    if (type === 't') {
      if (typeof v !== 'number') return v;
      const sec = ((Math.trunc(v) % 86400) + 86400) % 86400;
      return `${String(Math.floor(sec / 3600)).padStart(2, '0')}${String(Math.floor(sec / 60) % 60).padStart(2, '0')}${String(sec % 60).padStart(2, '0')}`;
    }
    if (type === 'd') {
      if (typeof v !== 'number') return v;
      if (!v) return '00000000';
      const base = new Date(Date.UTC(2000, 0, 1)); base.setUTCFullYear(1, 0, 1);
      const dt = new Date(base.getTime() + (Math.trunc(v) - 1) * 86400000);
      return `${String(dt.getUTCFullYear()).padStart(4, '0')}${String(dt.getUTCMonth() + 1).padStart(2, '0')}${String(dt.getUTCDate()).padStart(2, '0')}`;
    }
    if (!numeric) return v;
    const x = typeof v === 'number' ? v : this.n(v);
    if (type === 'p') return this.round(x, dec ?? 0);
    return this.round(x, 0);   // i, int8
  }
  // conversion into a statically typed target (the compiler passes the declared type): ABAP's conversion rules
  // for numbers (rounding, value range: CX_SY_ARITHMETIC_OVERFLOW for results of arithmetic, else
  // CX_SY_CONVERSION_OVERFLOW), fixed-length text c (cut at the length; a number right-aligned with its sign),
  // numeric text n (digits, zero-padded, the rightmost ones kept), bytes x (hex, padded with zero bytes) and xstring
  cv(t, v, calc) {
    if (v === undefined || (v !== null && typeof v === 'object')) return v;
    const overflow = () => this.new(calc ? 'cx_sy_arithmetic_overflow' : 'cx_sy_conversion_overflow', { text: `Overflow converting ${this.s(v).trim()} to type ${t.k.toUpperCase()}${t.len ? ` length ${t.len}` : ''}` });
    // text into a number: i, int8 and p take no scientific notation, f no blank between sign and digits
    if (typeof v === 'string' && ['i', 'int8', 'p', 'f'].includes(t.k)) {
      const txt = v.trim();
      if ((t.k !== 'f' && /\d[eE][+-]?\d/.test(txt)) || (t.k === 'f' && /^[+-]\s|\s[+-]$/.test(txt)))
        throw this.new('cx_sy_conversion_no_number', { text: `Unable to interpret '${txt}' as a number of type ${t.k.toUpperCase()}` });
    }
    switch (t.k) {
      case 'i': case 'int8': {
        const x = this.round(this.n(v ?? 0), 0);
        if (t.k === 'i' ? x > 2147483647 || x < -2147483648 : Math.abs(x) > 9223372036854775807) throw overflow();
        return x === 0 ? 0 : x;   // no -0
      }
      case 'p': {
        const x = this.round(this.n(v ?? 0), t.dec ?? 0);
        // value range: 2*len-1 digits, dec of them after the point. Packed numbers are doubles here, which round the
        // largest values up to the limit (P(31,6): 25 nines + .999999 is 1e25), so text is judged by its digits and
        // a number only when it is beyond the limit by more than rounding
        const intDigits = 2 * (t.len ?? 8) - 1 - (t.dec ?? 0), limit = 10 ** intDigits;
        let over = Math.abs(x) >= limit;
        if (over && typeof v === 'string') over = (/^[-+]?\s*0*(\d*)/.exec(v.trim())?.[1] || '').length > intDigits;
        else if (over && intDigits > 15) over = Math.abs(x) > limit * (1 + 8 * Number.EPSILON);
        if (over) throw overflow();
        return x === 0 ? 0 : x;
      }
      case 'f': return this.n(v ?? 0);
      case 'decfloat16': { const x = this.n(v ?? 0); return x === 0 ? 0 : Number(x.toPrecision(16)); }
      case 'decfloat34': case 'numeric': return this.n(v ?? 0);
      case 'c': {
        if (v === null) return '';
        if (typeof v === 'number') {
          const txt = Number.isInteger(v) ? `${Math.abs(v)}${v < 0 ? '-' : ' '}` : fmtNumber(v);
          return (txt.length > t.len ? txt.slice(-t.len) : txt.padStart(t.len)).trimEnd();
        }
        const str = String(v);
        return (str.length > t.len ? str.slice(0, t.len) : str).trimEnd();
      }
      case 'n': {
        const digits = typeof v === 'number' ? String(Math.abs(this.round(v, 0))) : String(v ?? '').replace(/\D/g, '');
        return digits.padStart(t.len, '0').slice(-t.len);
      }
      case 'x': case 'xstring': {
        let hex;
        if (typeof v === 'number') hex = (Math.trunc(v) >>> 0).toString(16).toUpperCase().padStart(8, '0');
        else hex = /^[0-9A-F]*/.exec(String(v ?? '').toUpperCase())[0];
        if (t.k === 'xstring') return hex.length % 2 ? `${hex}0` : hex;
        return typeof v === 'number' ? hex.padStart(2 * t.len, '0').slice(-2 * t.len) : hex.padEnd(2 * t.len, '0').slice(0, 2 * t.len);
      }
      case 'd': case 't': return this.conv(t.k, null, v);
    }
    return v;
  }
  // a time as seconds and a date as days since 0001-01-01 (operands of arithmetic expressions)
  tsec(v) { const s = this.s(v); return /^\d{6}$/.test(s) ? Number(s.slice(0, 2)) * 3600 + Number(s.slice(2, 4)) * 60 + Number(s.slice(4)) : this.n(v); }
  dnum(v) {
    const s = this.s(v);
    if (!/^\d{8}$/.test(s)) return this.n(v);
    if (s === '00000000') return 0;
    const base = new Date(Date.UTC(2000, 0, 1)); base.setUTCFullYear(1, 0, 1);
    const dt = new Date(Date.UTC(2000, Number(s.slice(4, 6)) - 1, Number(s.slice(6)))); dt.setUTCFullYear(Number(s.slice(0, 4)));
    return Math.round((dt.getTime() - base.getTime()) / 86400000) + 1;
  }
  // BIT-AND / BIT-OR / BIT-XOR / BIT-NOT on byte strings (hex): the shorter operand is padded with zero bytes on the
  // right; numbers count as their 4-byte integer representation; trailing zero bytes of the result are dropped, so a
  // result of only zero bytes compares like an initial byte field
  bit(op, a, b) {
    const hex = v => typeof v === 'number' ? (v >>> 0).toString(16).toUpperCase().padStart(8, '0') : this.s(v).toUpperCase().replace(/[^0-9A-F]/g, '');
    let x = hex(a), y = op === 'BIT-NOT' ? '' : hex(b);
    if (x.length % 2) x = '0' + x; if (y.length % 2) y = '0' + y;
    const n = Math.max(x.length, y.length);
    x = x.padEnd(n, '0'); y = y.padEnd(n, '0');
    let out = '';
    for (let i = 0; i < n; i += 2) {
      const p = parseInt(x.slice(i, i + 2), 16), q = parseInt(y.slice(i, i + 2), 16);
      const r = op === 'BIT-AND' ? p & q : op === 'BIT-OR' ? p | q : op === 'BIT-XOR' ? p ^ q : ~p & 0xff;
      out += r.toString(16).toUpperCase().padStart(2, '0');
    }
    return op === 'BIT-NOT' ? out : out.replace(/(00)+$/, '');
  }
  // SPLIT ... AT sep: a separator of blanks (SPLIT AT space, a c field) splits at a blank; text fields end without
  // trailing blanks, so a closing blank separator adds no empty last part
  sepOf(sep) { const s = this.s(sep); return s === '' || /^ +$/.test(s) ? ' ' : s; }
  splitAt(src, sep) {
    const sp = this.sepOf(sep);
    // an empty source splits into no parts
    if (this.s(src) === '') return [];
    const parts = this.s(src).split(sp);
    if (sp === ' ') while (parts.length > 1 && parts[parts.length - 1] === '') parts.pop();
    return parts;
  }
  initType(name) {
    if (DDIC_TABLE_TYPES.has(name)) return [];
    if (DDIC_STRUCTURES[name]) return { ...DDIC_STRUCTURES[name] };
    if (name.includes('=>')) {
      const [c, t] = name.split('=>');
      const C = this.cls(c);
      return C.$types?.[t] ? C.$types[t]() : '';
    }
    const fields = this.model?.fieldsOf(name);
    if (fields) {
      const o = {};
      // components typed with a structure / a table type (DDIC structures) are a structure / an internal table
      for (const f of fields) o[f.name] = f.struct ? this.initType(f.struct) : f.tableType ? [] : f.numeric ? 0 : '';
      return o;
    }
    const de = this.model?.dataElementInitial?.(name);
    return de ?? '';
  }
  resp(bo) {
    const out = {};
    if (bo && this.model) for (const a of this.model.aliasesOf(bo)) out[a] = [];
    return new Proxy(out, { get: (o, k) => (typeof k === 'string' && !(k in o) && !k.startsWith('$') && k !== 'toJSON' && k !== 'then' ? (o[k] = []) : o[k]) });
  }

  setp(obj, path, val) {
    let o = obj;
    for (let i = 0; i < path.length - 1; i++) {
      const k = path[i];
      if (o[k] === undefined || o[k] === null || typeof o[k] !== 'object') o[k] = {};
      o = o[k];
    }
    const last = path[path.length - 1];
    if (last === '%tky' || last === '%key' || last === '%pky') {
      const v = clone(val) || {};
      Object.assign(o, v);
      if (val?.[TAG] && !o[TAG]) this.tag(o, val[TAG]);
      return;
    }
    if (last === '%data') { Object.assign(o, clone(val)); return; }
    o[last] = val;
  }
  struct(base, comps) {
    for (const [path, v] of comps) this.setp(base, path, v);
    return base;
  }
  tabAt(base, path) {
    let o = base;
    for (let i = 0; i < path.length; i++) {
      const k = path[i];
      if (o[k] === undefined || o[k] === null) o[k] = i === path.length - 1 ? [] : {};
      o = o[k];
    }
    if (!Array.isArray(o)) throw this.new('cx_sy_itab_error', { text: `${path.join('-')} is not an internal table` });
    return o;
  }
  // itab[ ... ] = value: the line must exist (else CX_SY_ITAB_LINE_NOT_FOUND)
  tabSet(tab, idx, v) {
    this.tabRow(tab, idx);
    tab[idx] = clone(v);
  }
  tabRow(tab, idx) {
    if (!Array.isArray(tab) || idx < 0 || idx >= tab.length) throw this.new('cx_sy_itab_line_not_found', { text: 'Table line not found' });
    return tab[idx];
  }
  fsAssign(fs, val) {
    if (fs && typeof fs === 'object' && val && typeof val === 'object') {
      if (Array.isArray(fs)) { fs.splice(0, fs.length, ...clone(val)); return fs; }
      for (const k of Object.keys(fs)) delete fs[k];
      Object.assign(fs, clone(val));
      return fs;
    }
    return val;
  }
  appendLines(dst, src, from) {
    const rows = clone(src || []);
    dst.push(...(from ? rows.slice(this.n(from) - 1) : rows));
  }
  insertTable(dst, v) {
    if (dst?.$sort) { const i = dst.findIndex(r => this.sortCmp(v, r, dst.$sort) < 0); dst.splice(i < 0 ? dst.length : i, 0, v); } else dst.push(v);
    this.sy.subrc = 0;
  }
  sortCmp(a, b, keys) {
    for (const c of keys) { const x = c === 'table_line' ? a : a?.[c], y = c === 'table_line' ? b : b?.[c]; const r = this.cmp(x, y); if (r) return r; }
    return 0;
  }
  modifyRow(row, wa, fields) {
    if (!row) { this.sy.subrc = 4; return; }
    const src = clone(wa);
    if (fields) for (const f of fields) row[f] = src[f];
    else Object.assign(row, src);
    this.sy.subrc = 0;
  }
  deleteWhere(tab, pred) {
    let w = 0, n = 0;
    for (let r = 0; r < tab.length; r++) { if (pred(tab[r])) { n++; continue; } tab[w++] = tab[r]; }
    tab.length = w;
    this.sy.subrc = n ? 0 : 4;
  }
  // a data object named at runtime: { get, set } or null. scope: the compiler's accessors of the variables in scope
  dynRef(scope, self, name) {
    const full = this.s(name).trim().toLowerCase();
    let base, rest = full, get, set;
    const m = /^([\w/<>]+)(=>|->)?(.*)$/.exec(full);
    if (!m) return null;
    if (m[2] === '=>') { const C = this.hasClass(m[1]) ? this.cls(m[1]) : null; if (!C) return null; const [a, ...p] = m[3].split('-'); base = C; rest = [a, ...p].join('-'); get = () => C; }
    else if (m[1] === 'me' && m[2] === '->') { rest = m[3]; get = () => self; }
    else {
      const [a] = m[1].split('-');
      const acc = scope[a];
      if (acc) { [get, set] = acc; rest = full.slice(a.length).replace(/^-/, ''); }
      else if (self && typeof self === 'object' && a in self) { get = () => self; rest = full; }
      else if (self?.constructor && a in self.constructor) { get = () => self.constructor; rest = full; }
      else return null;
    }
    const path = rest ? rest.split('-') : [];
    if (!path.length) return { get, set };
    let o = get();
    for (const k of path.slice(0, -1)) { if (o == null || typeof o !== 'object' || !(k in o)) return null; o = o[k]; }
    const last = path.at(-1);
    if (o == null || typeof o !== 'object' || !(last in o)) return null;
    return { get: () => o[last], set: v => { o[last] = v; } };
  }
  // ABAP memory (EXPORT/IMPORT ... MEMORY ID), SAP memory (SET/GET PARAMETER), data buffers and data clusters
  get abapMemory() { return (this.$abapMemory ||= new Map()); }
  get sapMemory() { return (this.$sapMemory ||= new Map()); }
  freeMemory(id) { if (id === null || id === undefined) this.abapMemory.clear(); else this.abapMemory.delete(this.s(id)); }
  clusterTable() {
    if (this.$clusterReady) return;
    this.sql?.db?.exec?.('CREATE TABLE IF NOT EXISTS rap_data_cluster (tab TEXT NOT NULL, area TEXT NOT NULL, id TEXT NOT NULL, data TEXT, PRIMARY KEY (tab, area, id))');
    this.$clusterReady = true;
  }
  exportData(values, where) {
    if (where.kind === 'memory') this.abapMemory.set(where.id, values);
    else if (where.kind === 'buffer') where.ref.set(Buffer.from(JSON.stringify(values), 'utf8').toString('hex').toUpperCase());
    else if (where.kind === 'itab') where.ref.set(JSON.stringify(values).match(/.{1,255}/g).map(clustd => ({ clustr: clustd.length, clustd })));
    else {
      const db = this.sql?.db;
      if (!db) throw this.new('cx_sy_open_sql_db', { text: 'No database for EXPORT TO DATABASE' });
      this.clusterTable();
      db.prepare('DELETE FROM rap_data_cluster WHERE tab = ? AND area = ? AND id = ?').run(where.table, where.area, where.id);
      db.prepare('INSERT INTO rap_data_cluster (tab, area, id, data) VALUES (?, ?, ?, ?)').run(where.table, where.area, where.id, JSON.stringify(values));
    }
    this.sy.subrc = 0;
  }
  importData(where) {
    try {
      if (where.kind === 'memory') return this.abapMemory.get(where.id) ?? null;
      if (where.kind === 'buffer') { const hex = this.s(where.ref.get()); return hex ? JSON.parse(Buffer.from(hex, 'hex').toString('utf8')) : null; }
      if (where.kind === 'itab') { const t = where.ref.get(); return Array.isArray(t) && t.length ? JSON.parse(t.map(r => r.clustd).join('')) : null; }
      const db = this.sql?.db;
      if (!db) return null;
      this.clusterTable();
      const row = db.prepare('SELECT data FROM rap_data_cluster WHERE tab = ? AND area = ? AND id = ?').get(where.table, where.area, where.id);
      return row ? JSON.parse(row.data) : null;
    } catch { return null; }
  }
  deleteDataCluster(table, area, id) {
    const db = this.sql?.db;
    if (!db) return;
    this.clusterTable();
    const r = db.prepare('DELETE FROM rap_data_cluster WHERE tab = ? AND area = ? AND id = ?').run(table, area, this.s(id));
    this.sy.subrc = Number(r.changes) ? 0 : 4;
  }
  // EXPORT (ptab) / IMPORT (ptab): lines with NAME and VALUE (the name of a data object)
  exportDyn(ptab, where, scope, self) {
    const values = {};
    for (const r of ptab) { const ref = this.dynRef(scope, self, r.value ?? r.dobj); if (!ref) throw this.new('cx_sy_dyn_call_illegal_method', { text: `Data object ${this.s(r.value ?? r.dobj).toUpperCase()} does not exist` }); values[this.s(r.name).toLowerCase()] = this.clone(ref.get()); }
    this.exportData(values, where);
  }
  importDyn(ptab, where, scope, self) {
    const data = this.importData(where);
    if (!data) { this.sy.subrc = 4; return; }
    for (const r of ptab) { const n = this.s(r.name).toLowerCase(); const ref = this.dynRef(scope, self, r.value ?? r.dobj); if (ref && n in data) ref.set ? ref.set(this.clone(data[n])) : null; }
    this.sy.subrc = 0;
  }
  collect(tab, wa) {
    const num = v => typeof v === 'number';
    const keys = Object.keys(wa).filter(k => !num(wa[k]));
    const hit = tab.findIndex(r => keys.every(k => this.eq(r[k], wa[k])));
    if (hit < 0) { tab.push(this.clone(wa)); this.sy.tabix = tab.length; return; }
    for (const k of Object.keys(wa)) if (num(wa[k])) tab[hit][k] = this.n(tab[hit][k]) + wa[k];
    this.sy.tabix = hit + 1;
  }
  deleteFromTable(tab, wa) { this.deleteWhere(tab, r => this.eq(r, wa)); }
  deleteAdjacent(tab, comps) {
    const same = (a, b) => (comps ? comps.every(c => this.eq(a?.[c], b?.[c])) : this.eq(a, b));
    let w = 0;
    for (let r = 0; r < tab.length; r++) { if (w > 0 && same(tab[w - 1], tab[r])) continue; tab[w++] = tab[r]; }
    tab.length = w;
  }
  // a table of a SORTED table type: its rows in key order
  sorted(tab, keys) { if (Array.isArray(tab)) this.sort(tab, keys.map(c => ({ c }))); return tab; }
  // rows of a VALUE constructor for the table type of `like` (an initial table of it): sorted when that type is SORTED
  sortedAs(tab, like) { return like?.$sort && Array.isArray(tab) ? this.sorted(tab, like.$sort) : tab; }
  sort(tab, keys, desc) {
    // dynamic components: a name (any case), or the rows of an abap_sortorder_tab (name, descending, astext)
    keys = keys.flatMap(k => {
      if (!('dyn' in k)) return [k];
      if (Array.isArray(k.dyn)) return k.dyn.map(r => ({ c: String(r.name ?? '').trim().toLowerCase(), desc: String(r.descending ?? '').trim() === 'X' })).filter(x => x.c);
      const c = String(k.dyn ?? '').trim().toLowerCase();
      return c ? [{ c, desc: k.desc }] : [];
    });
    const ks = keys.length ? keys : [{ c: null, desc }];
    tab.sort((a, b) => {
      for (const k of ks) {
        const x = k.c ? (k.c === 'table_line' ? a : a?.[k.c]) : a, y = k.c ? (k.c === 'table_line' ? b : b?.[k.c]) : b;
        const c = typeof x === 'object' && x ? JSON.stringify(x).localeCompare(JSON.stringify(y)) : this.cmp(x, y);
        if (c) return k.desc ? -c : c;
      }
      return 0;
    });
  }
  inRange(v, range) {
    if (!Array.isArray(range) || !range.length) return true;
    let incl = null, excluded = false;
    for (const r of range) {
      const hit = this.rangeHit(v, r);
      const sign = String(r.sign || 'I').toUpperCase();
      if (sign === 'I') { if (incl === null) incl = false; if (hit) incl = true; }
      else if (hit) excluded = true;
    }
    return (incl === null || incl) && !excluded;
  }
  rangeHit(v, r) {
    const op = String(r.option || 'EQ').toUpperCase();
    switch (op) {
      case 'EQ': return this.eq(v, r.low);
      case 'NE': return !this.eq(v, r.low);
      case 'GT': return this.cmp(v, r.low) > 0;
      case 'GE': return this.cmp(v, r.low) >= 0;
      case 'LT': return this.cmp(v, r.low) < 0;
      case 'LE': return this.cmp(v, r.low) <= 0;
      case 'BT': return this.cmp(v, r.low) >= 0 && this.cmp(v, r.high) <= 0;
      case 'NB': return !(this.cmp(v, r.low) >= 0 && this.cmp(v, r.high) <= 0);
      case 'CP': return this.strop('CP', v, r.low);
      case 'NP': return !this.strop('CP', v, r.low);
    }
    return false;
  }
  strop(op, a, b) {
    const x = this.s(a), y = this.s(b);
    switch (op) {
      case 'CS': return x.toLowerCase().includes(y.replace(/ +$/, '').toLowerCase());
      case 'NS': return !this.strop('CS', a, b);
      case 'CP': {
        const re = new RegExp('^' + y.replace(/ +$/, '').replace(/[.^$|()[\]{}\\?]/g, '\\$&').replace(/\*/g, '.*').replace(/\+/g, '.') + '$', 'is');
        return re.test(x.replace(/ +$/, ''));
      }
      case 'NP': return !this.strop('CP', a, b);
      case 'CO': return [...x].every(c => y.includes(c));
      case 'CN': return !this.strop('CO', a, b);
      case 'CA': return [...x].some(c => y.includes(c));
      case 'NA': return !this.strop('CA', a, b);
    }
    throw new Error('Unknown operator ' + op);
  }
  // a packed number as text with the decimals of its type: 600 -> '600.00' (trailing: '600.00-' as in a c field)
  pstr(v, dec, trailing) {
    if (v === null || v === undefined || (typeof v === 'string' && v.trim() === '')) return v;
    const x = typeof v === 'number' ? v : this.n(v);
    if (!Number.isFinite(x)) return v;
    const s = this.round(Math.abs(x), dec).toFixed(dec);
    return x < 0 ? (trailing ? `${s}-` : `-${s}`) : s;
  }
  fmt(v, opts) {
    let s = this.s(v);
    if (typeof v === 'string' && !opts?.$keep) s = s.replace(/ +$/, '');
    if (opts) {
      if (opts.time === 'ISO' || opts.time === 'USER' || opts.time === 'ENVIRONMENT') s = /^\d{6}$/.test(s) ? `${s.slice(0, 2)}:${s.slice(2, 4)}:${s.slice(4)}` : s;
      if (opts.decimals !== undefined && typeof v !== 'number' && s.trim() !== '' && !Number.isNaN(Number(s))) s = this.round(Number(s), Number(opts.decimals)).toFixed(Number(opts.decimals));
      if (opts.width !== undefined) { const w = Number(opts.width); s = opts.align === 'RIGHT' ? s.padStart(w) : opts.align === 'CENTER' ? s.padStart(Math.floor((w + s.length) / 2)).padEnd(w) : s.padEnd(w); }
      if (opts.alpha === 'OUT') s = s.replace(/^0+(?=.)/, '');
      if (opts.date === 'ISO' || opts.date === 'USER' || opts.date === 'ENVIRONMENT') s = /^\d{8}$/.test(s) ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6)}` : s;
      if (opts.case === 'UPPER') s = s.toUpperCase();
      if (opts.case === 'LOWER') s = s.toLowerCase();
      if (opts.decimals !== undefined && typeof v === 'number') s = this.round(v, Number(opts.decimals)).toFixed(Number(opts.decimals));
    }
    return s;
  }
  replace(str, what, by, all, regex, ignoreCase) {
    const s = this.s(str);
    const w = regex ? abapRegex(this.s(what)) : this.s(what).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(w, (all ? 'g' : '') + (ignoreCase ? 'i' : ''));
    const out = s.replace(re, this.s(by));
    this.sy.subrc = out === s ? 4 : 0;
    return out;
  }
  // CORRESPONDING #( itab FROM lookup USING a = b ): each row takes the identically named components of the
  // first lookup row whose b equals the row's a (rows without a match stay unchanged)
  correspondingLookup(src, lookup, on, mapping, except) {
    return (src || []).map(row => {
      const hit = (lookup || []).find(l => on.every(([a, b]) => this.eq(row[a], l[b])));
      if (!hit) return clone(row);
      const o = clone(row);
      for (const [k, v] of Object.entries(hit)) if (!except.includes(k) && !on.some(([a]) => a === k)) o[k] = clone(v);
      for (const [t, s2] of mapping) o[t] = clone(hit[s2]);
      return o;
    });
  }
  corresponding(src, base, mapping, except, shape, intoStruct, appending) {
    if (appending && base && !Array.isArray(base) && src && typeof src === 'object' && !Array.isArray(src)) {
      // APPENDING ( base ): table components are appended, other components assigned
      const out = clone(base);
      for (const [k, v] of Object.entries(src)) {
        if (except.includes(k) || !(k in out)) continue;
        out[k] = Array.isArray(out[k]) && Array.isArray(v) ? [...out[k], ...clone(v)] : clone(v);
      }
      for (const [t, s2] of mapping) out[t] = clone(src[s2]);
      return out;
    }
    const filterKeys = shape ? Object.keys(this.initType(shape) || {}) : null;
    const conv = row => {
      if (!row || typeof row !== 'object') return row;
      const o = {};
      for (const [k, v] of Object.entries(row)) {
        if (except.includes(k) || except.includes('*')) continue;
        if (filterKeys && filterKeys.length && !filterKeys.includes(k) && !k.startsWith('%')) continue;
        o[k] = clone(v);
      }
      for (const [t, s] of mapping) { o[t] = clone(row[s]); }
      if (row[TAG]) this.tag(o, row[TAG]);
      return o;
    };
    if (Array.isArray(src)) {
      const rows = src.map(conv);
      return base ? [...clone(base), ...rows] : rows;
    }
    const o = conv(src);
    if (base && typeof base === 'object' && !Array.isArray(base)) {
      const merged = clone(base);
      if (intoStruct) { for (const k of Object.keys(merged)) if (k in o) merged[k] = o[k]; return merged; }
      return Object.assign(merged, o);
    }
    return o;
  }
  sub(v, off, len) {
    const s = typeof v === 'number' ? String(v) : this.s(v);
    const o = this.n(off);
    return len === undefined ? s.slice(o) : s.slice(o, o + this.n(len)).padEnd(this.n(len), ' ');
  }
  overlay(v, off, len, val) {
    const s = this.s(v);
    const o = this.n(off);
    const l = len === undefined ? Math.max(0, s.length - o) : this.n(len);
    const ins = this.s(val).padEnd(l, ' ').slice(0, l);
    return (s.padEnd(o, ' ').slice(0, o) + ins + s.slice(o + l)).replace(/ +$/, '');
  }
  // FIND ... IN TABLE: rows are searched one by one; results carry the line number
  findInTable(tab, pattern, all, regex, ignoreCase) {
    const results = [];
    let sub = [];
    for (const [i, row] of (tab || []).entries()) {
      const r = this.find(typeof row === 'object' && row !== null ? Object.values(row).map(v => this.s(v)).join('') : row, pattern, all, regex, ignoreCase);
      for (const x of r.results) results.push({ ...x, line: i + 1 });
      if (r.results.length && !sub.length) sub = r.sub;
      if (results.length && !all) break;
    }
    this.sy.subrc = results.length ? 0 : 4;
    const pick = all ? results[results.length - 1] : results[0];
    return { count: results.length, line: pick?.line ?? 0, offset: pick?.offset ?? 0, length: pick?.length ?? 0, results, sub };
  }
  // SHIFT
  shift(v, o) {
    let s = this.s(v);
    if (o.deleting) {
      const mask = this.s(o.mask);
      const inMask = c => mask.includes(c);
      if (o.deleting === 'leading') { let k = 0; while (k < s.length && inMask(s[k])) k++; return s.slice(k); }
      let k = s.length; while (k > 0 && inMask(s[k - 1])) k--; return s.slice(0, k);
    }
    let n = 1;
    if (o.places !== undefined) n = this.n(o.places);
    else if (o.upTo !== undefined) {
      const sub = this.s(o.upTo), idx = s.indexOf(sub);
      if (idx < 0) { this.sy.subrc = 4; return s; }
      n = o.dir === 'left' ? idx : s.length - (idx + sub.length);
    }
    this.sy.subrc = 0;
    if (!n) return s;
    if (o.circular) { n %= s.length || 1; return o.dir === 'left' ? s.slice(n) + s.slice(0, n) : s.slice(s.length - n) + s.slice(0, s.length - n); }
    return o.dir === 'left' ? s.slice(n) : ' '.repeat(Math.min(n, s.length)) + s.slice(0, Math.max(0, s.length - n));
  }
  // CONVERT: UTC <-> local date/time of a time zone (SAP time zone names or IANA names)
  tsToLocal(ts, tz, utclong) {
    const d = utclong ? parseUtclong(ts) : tsDate(ts);
    if (!d || isNaN(d)) { this.sy.subrc = 12; return { date: '00000000', time: '000000', frac: 0, dst: '' }; }
    const p = zoned(d, tz);
    this.sy.subrc = 0;
    return { date: `${p.year}${p.month}${p.day}`, time: `${p.hour}${p.minute}${p.second}`, frac: utclong ? Number(`0.${String(ts).split('.')[1] || 0}`) : 0, dst: p.dst ? 'X' : '' };
  }
  localToTs(date, time, tz, utclong) {
    const d = this.s(date), t = this.s(time).padEnd(6, '0');
    const guess = Date.UTC(+d.slice(0, 4), +d.slice(4, 6) - 1, +d.slice(6, 8), +t.slice(0, 2), +t.slice(2, 4), +t.slice(4, 6));
    // local wall time -> UTC: subtract the zone offset at that instant (two passes for DST edges)
    let ms = guess - zoneOffset(guess, tz);
    ms = guess - zoneOffset(ms, tz);
    const x = new Date(ms);
    const pad = (n, l = 2) => String(n).padStart(l, '0');
    this.sy.subrc = 0;
    if (utclong) return `${x.getUTCFullYear()}-${pad(x.getUTCMonth() + 1)}-${pad(x.getUTCDate())}T${pad(x.getUTCHours())}:${pad(x.getUTCMinutes())}:${pad(x.getUTCSeconds())}.0000000`;
    return Number(`${x.getUTCFullYear()}${pad(x.getUTCMonth() + 1)}${pad(x.getUTCDate())}${pad(x.getUTCHours())}${pad(x.getUTCMinutes())}${pad(x.getUTCSeconds())}`);
  }
  // CALL TRANSFORMATION id: asXML (or JSON for a JSON writer) and back
  transformation(name, src, res) {
    if (name !== 'id') {
      const prog = this.transformations?.[name];
      if (!prog) throw this.new('cx_sy_dyn_call_illegal_method', { text: `Transformation ${name.toUpperCase()} does not exist (src/${name}.xslt.source.xml)` });
      const xmlIn = src.xml !== undefined ? (typeof src.xml === 'object' && src.xml?.$writer ? src.xml.output : this.s(src.xml)) : null;
      let out;
      try {
        if (isSimpleTransformation(prog)) {
          if (xmlIn !== null) return { values: stDeserialize(prog, xmlIn) };
          out = stSerialize(prog, src.values);
        } else {
          const r = runXslt(prog, parseXml(xmlIn ?? toAsXml(src.values, this)));
          out = r.text;
          if (!res.xml) return { values: fromAsXml(out) };
        }
      } catch (e) { throw this.new('cx_xslt_runtime_error', { text: `${name.toUpperCase()}: ${e.message}` }); }
      if (res.target && typeof res.target === 'object' && res.target.$writer) { res.target.output = out; return { xml: res.target }; }
      return { xml: out };
    }
    if (src.xml !== undefined) {
      let text = typeof src.xml === 'object' && src.xml?.$writer ? src.xml.output : this.s(src.xml);
      if (/^([0-9A-F]{2})+$/.test(text)) text = Buffer.from(text, 'hex').toString('utf8');   // an xstring (UTF-8 bytes)
      return { values: text.trim().startsWith('{') ? fromAbapJson(JSON.parse(text)) : fromAsXml(text) };
    }
    if (res.xml && res.target && typeof res.target === 'object' && res.target.$writer) {
      res.target.output = res.target.type === 'json' ? JSON.stringify(toAbapJson(src.values)) : toAsXml(src.values, this);
      return { xml: res.target };
    }
    return { xml: toAsXml(src.values, this), values: src.values };
  }
  find(text, pattern, all, regex, ignoreCase) {
    const s = this.s(text);
    const p = this.s(pattern);
    const re = new RegExp(regex ? abapRegex(p) : p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g' + (ignoreCase ? 'i' : ''));
    const results = [];
    let m;
    while (p !== '' && (m = re.exec(s))) {
      const subs = [];
      let pos = m.index;
      for (let g = 1; g < m.length; g++) { const gi = m[g] === undefined ? -1 : s.indexOf(m[g], pos); subs.push({ offset: gi, length: m[g]?.length ?? 0 }); }
      results.push({ line: 0, offset: m.index, length: m[0].length, submatches: subs, $sub: m.slice(1).map(x => x ?? '') });
      if (!all) break;
      if (m[0] === '') re.lastIndex++;
    }
    this.sy.subrc = results.length ? 0 : 4;
    const first = results[0];
    const last = results[results.length - 1];
    return { count: results.length, offset: (all ? last : first)?.offset ?? 0, length: (all ? last : first)?.length ?? 0, results: results.map(({ $sub, ...r }) => r), sub: (all ? last : first)?.$sub ?? [] };
  }
  // ABAP Objects events
  setHandler(handlers, target, active) {
    this.eventHandlers ||= [];
    for (const [obj, method] of handlers) {
      this.eventHandlers = this.eventHandlers.filter(h => !(h.obj === obj && h.method === method && h.target === target));
      if (active) this.eventHandlers.push({ obj, method, target });
    }
  }
  raiseEvent(sender, event, args) {
    for (const h of this.eventHandlers || []) {
      if (h.target !== null && h.target !== sender) continue;
      const C = h.obj?.constructor;
      const meta = (h.obj && (typeof h.obj === 'function' ? h.obj.$meta : C?.$meta)) || null;
      void meta;
      this.call(h.obj, h.method, { ...args, sender });
    }
  }
  // CORRESPONDING ... MAPPING FROM ENTITY (element names -> database columns, per BDEF "mapping for")
  // and MAPPING TO ENTITY (columns -> element names; the entity comes from the target type or the row)
  mapEntity(src, direction, shape) {
    const conv = (row) => {
      if (!row || typeof row !== 'object') return row;
      const entity = direction === 'to' && shape ? this.model.baseEntity(shape) || shape : row.$e || this.entityOf(row);
      const ent = this.model?.entities.get(entity);
      const mapping = ent?.mapping || {};
      const out = {};
      if (direction === 'from') {
        for (const [k, v] of Object.entries(row)) if (!k.startsWith('%')) out[mapping[k] || k] = clone(v);
      } else {
        const inv = Object.fromEntries(Object.entries(mapping).map(([el, col]) => [col, el]));
        for (const [k, v] of Object.entries(row)) if (!k.startsWith('%')) out[inv[k] || k] = clone(v);
        if (entity) this.tag(out, entity);
      }
      return out;
    };
    return Array.isArray(src) ? src.map(conv) : conv(src);
  }
  moveCorresponding(src, tgt, keepLines) {
    if (Array.isArray(src)) {
      const rows = src.map(r => this.corresponding(r, Array.isArray(tgt) && tgt.length ? this.initialOf(tgt[0]) : null, [], [], null, true));
      return keepLines && Array.isArray(tgt) ? [...tgt, ...rows] : rows;
    }
    return this.corresponding(src, tgt, [], [], null, true);
  }
  timestampl() {
    const d = new Date();
    const p = (n, l = 2) => String(n).padStart(l, '0');
    return Number(`${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}.${p(d.getUTCMilliseconds(), 3)}`);
  }
  write(v) { this.output.push(typeof v === 'object' ? JSON.stringify(v, null, 2) : this.s(v)); }
  log(...a) { this.logs.push(a.join(' ')); }
  // text of message number num of message class id (&1..&4 / & replaced)
  msgText(id, num, args = []) { return this.message({ id, number: num, v1: args[0], v2: args[1], v3: args[2], v4: args[3] }).text; }
  message(p) {
    // build a behavior message from new_message / new_message_with_text parameters
    const sev = String(p.severity ?? 'E').trim() || 'E';
    let text = p.text;
    if (text === undefined) {
      const id = String(p.id || '').toLowerCase();
      const num = String(p.number ?? '').padStart(3, '0');
      const tpl = this.messages[id]?.[num];
      const vs = [p.v1, p.v2, p.v3, p.v4].map(v => this.fmt(v ?? ''));
      if (tpl) {
        let k = 0;
        text = tpl.replace(/&(\d)?/g, (_, d) => vs[d ? Number(d) - 1 : k++] ?? '');
      } else text = `${String(p.id || '').toUpperCase()}(${num}) ${vs.filter(Boolean).join(' ')}`.trim();
    }
    const M = this.classes.get('$behv_message');
    const m = new M();
    m.$message = true; m.severity = sev; m.text = String(text);
    m.m_severity = sev; m['if_abap_behv_message~m_severity'] = sev;
    return m;
  }
}

// ---------------------------------------------------------------------------------- helpers
function findMethodKey(obj, name) {
  const suffix = '~' + name;
  for (let p = obj; p && p !== Object.prototype && p !== Function.prototype; p = Object.getPrototypeOf(p)) {
    for (const k of Object.getOwnPropertyNames(p)) if (k.endsWith(suffix)) return k;
  }
  return null;
}
function toNumLoose(v) {
  if (typeof v === 'number') return v;
  if (v === '' || v === undefined || v === null) return 0;
  const s = String(v).trim();
  if (s === '') return 0;
  const x = Number(s);
  return Number.isNaN(x) ? null : x;
}
function round(x) { return Math.abs(x) < 1e15 ? Math.round(x * 1e10) / 1e10 : x; }
function fmtNumber(v) {
  if (Number.isInteger(v)) return String(v);
  return String(Math.round(v * 1e10) / 1e10);
}
// data reference (REF #( ), GET REFERENCE, CREATE DATA, NEW for data types, REFERENCE INTO): points at a variable,
// a table row or an anonymous data object; dref->* reads and writes the referenced data
export class DataRef {
  #get; #set;
  constructor(get, set) { this.#get = get; this.#set = set; }
  get() { return this.#get(); }
  set(v) { this.#set(v); }
}
export function clone(v) {
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) { const a = v.map(clone); for (const m of ['$line', '$sort']) if (v[m]) Object.defineProperty(a, m, { value: v[m], enumerable: false }); return a; }
  if (Object.getPrototypeOf(v) !== Object.prototype && Object.getPrototypeOf(v) !== null) return v; // object references
  const o = {};
  for (const k of Object.keys(v)) o[k] = clone(v[k]);
  if (v[TAG]) Object.defineProperty(o, TAG, { value: v[TAG], enumerable: false, writable: true, configurable: true });
  return o;
}
function deepEqual(a, b, rt) {
  if (a === b) return true;
  const ao = a && typeof a === 'object', bo = b && typeof b === 'object';
  if (!ao || !bo) {
    // structure vs initial value
    if (ao && rt.initial(b)) return rt.initial(a);
    if (bo && rt.initial(a)) return rt.initial(b);
    return false;
  }
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) return a.length === b.length && a.every((x, i) => rt.eq(x, b[i]));
  if (Object.getPrototypeOf(a) !== Object.prototype || Object.getPrototypeOf(b) !== Object.prototype) return a === b;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) if (!rt.eq(a[k], b[k])) return false;
  return true;
}

function makeSy() {
  const p = (n, l = 2) => String(n).padStart(l, '0');
  const sy = {
    subrc: 0, tabix: 0, index: 0, dbcnt: 0, mandt: '100', langu: 'E', uname: 'DEVELOPER', sysid: 'RAP', msgid: '', msgno: '',
    abcde: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', fdpos: 0, msgty: '', msgv1: '', msgv2: '', msgv3: '', msgv4: '', host: 'localhost', saprl: '758',
  };
  Object.defineProperty(sy, 'datum', { enumerable: true, get() { const d = new Date(); return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`; } });
  Object.defineProperty(sy, 'uzeit', { enumerable: true, get() { const d = new Date(); return `${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`; } });
  return sy;
}

// ABAP regular expressions (POSIX) in JavaScript syntax: bracket classes [:alpha:] ..., word boundaries \< \>
const POSIX = { alpha: 'A-Za-z', digit: '0-9', alnum: 'A-Za-z0-9', upper: 'A-Z', lower: 'a-z', space: '\\s', blank: ' \\t',
  punct: '!-\\/:-@\\[-`{-~', xdigit: '0-9A-Fa-f', cntrl: '\\x00-\\x1f\\x7f', print: '\\x20-\\x7e', graph: '\\x21-\\x7e', word: '\\w' };
export function abapRegex(p) {
  return String(p).replace(/\[:(\w+):\]/g, (m, n) => POSIX[n] ?? m).replace(/\\<|\\>/g, '\\b');
}

// ---------------------------------------------------------------------------------- builtins
function makeBuiltins(rt) {
  // rounding with a mode (CL_ABAP_MATH=>round_*): to dec decimal places, or to prec significant digits
const ROUND_MODES = { 1: 'half_up', 2: 'half_down', 3: 'half_even', 4: 'up', 5: 'down', 6: 'ceiling', 7: 'floor' };
function roundMode(x, p) {
  let dec;
  if (p.prec !== undefined) { const prec = Number(p.prec); dec = x === 0 ? 0 : prec - 1 - Math.floor(Math.log10(Math.abs(x))); }
  else dec = Number(p.dec ?? 0);
  const mode = ROUND_MODES[Number(p.mode ?? 1)] || 'half_up';
  const scaled = Number(`${Math.abs(x)}e${dec}`), sign = x < 0 ? -1 : 1;
  const fl = Math.floor(scaled), diff = scaled - fl, EPS = 1e-9;
  let r;
  switch (mode) {
    case 'half_up': r = diff >= 0.5 - EPS ? fl + 1 : fl; break;
    case 'half_down': r = diff > 0.5 + EPS ? fl + 1 : fl; break;
    case 'half_even': r = Math.abs(diff - 0.5) < EPS ? (fl % 2 ? fl + 1 : fl) : Math.round(scaled); break;
    case 'up': r = diff > EPS ? fl + 1 : fl; break;
    case 'down': r = fl; break;
    case 'ceiling': r = sign > 0 ? (diff > EPS ? fl + 1 : fl) : fl; break;
    case 'floor': r = sign < 0 ? (diff > EPS ? fl + 1 : fl) : fl; break;
  }
  const out = sign * Number(`${r}e${-dec}`);
  return out === 0 ? 0 : out;
}
const arg = (p, name) => (p[name] !== undefined ? p[name] : p.$0);
  const val = p => rt.s(arg(p, 'val'));
  return {
    lines: p => (Array.isArray(arg(p, 'val')) ? arg(p, 'val').length : 0),
    strlen: p => val(p).replace(/ +$/, '').length,
    numofchar: p => val(p).replace(/ +$/, '').length,
    condense: p => {
      const del = p.del !== undefined ? rt.s(p.del) : ' ';
      let s = val(p);
      if (del === ' ' || del === '') s = s.trim().replace(/ {2,}/g, ' ');
      else { const re = new RegExp(`^[${escRe(del)}]+|[${escRe(del)}]+$`, 'g'); s = s.replace(re, ''); }
      if (p.from !== undefined) s = s.split(rt.s(p.from)).join(rt.s(p.to ?? ''));
      return s;
    },
    to_upper: p => val(p).toUpperCase(),
    to_lower: p => val(p).toLowerCase(),
    to_mixed: p => val(p).toLowerCase().replace(/_([a-z])/g, (_, c) => c.toUpperCase()),
    from_mixed: p => val(p).replace(/([A-Z])/g, '_$1').toUpperCase(),
    abs: p => Math.abs(rt.n(arg(p, 'val'))),
    ceil: p => Math.ceil(rt.n(arg(p, 'val'))),
    floor: p => Math.floor(rt.n(arg(p, 'val'))),
    trunc: p => Math.trunc(rt.n(arg(p, 'val'))),
    frac: p => { const x = rt.n(arg(p, 'val')); return x - Math.trunc(x); },
    sign: p => Math.sign(rt.n(arg(p, 'val'))),
    sqrt: p => Math.sqrt(rt.n(arg(p, 'val'))),
    exp: p => Math.exp(rt.n(arg(p, 'val'))),
    log: p => Math.log(rt.n(arg(p, 'val'))),
    log10: p => Math.log10(rt.n(arg(p, 'val'))),
    sin: p => Math.sin(rt.n(arg(p, 'val'))), cos: p => Math.cos(rt.n(arg(p, 'val'))), tan: p => Math.tan(rt.n(arg(p, 'val'))),
    acos: p => Math.acos(rt.n(arg(p, 'val'))), asin: p => Math.asin(rt.n(arg(p, 'val'))), atan: p => Math.atan(rt.n(arg(p, 'val'))),
    cosh: p => Math.cosh(rt.n(arg(p, 'val'))), sinh: p => Math.sinh(rt.n(arg(p, 'val'))), tanh: p => Math.tanh(rt.n(arg(p, 'val'))),
    // round( val dec | prec [mode] ) and rescale( val dec | prec [mode] ): decimal places or significant digits,
    // with the rounding modes of CL_ABAP_MATH (default: half up)
    round: p => roundMode(rt.n(arg(p, 'val')), p),
    rescale: p => roundMode(rt.n(arg(p, 'val')), p),
    xstrlen: p => Math.ceil(rt.s(arg(p, 'val')).length / 2),
    ipow: p => rt.n(p.base) ** rt.n(p.exp),
    nmax: p => Math.max(...['val1', 'val2', 'val3', 'val4', 'val5', 'val6', 'val7', 'val8', 'val9'].filter(k => p[k] !== undefined).map(k => rt.n(p[k]))),
    nmin: p => Math.min(...['val1', 'val2', 'val3', 'val4', 'val5', 'val6', 'val7', 'val8', 'val9'].filter(k => p[k] !== undefined).map(k => rt.n(p[k]))),
    cmax: p => ['val1', 'val2', 'val3', 'val4', 'val5', 'val6', 'val7', 'val8', 'val9'].filter(k => p[k] !== undefined).map(k => rt.s(p[k])).sort().pop(),
    cmin: p => ['val1', 'val2', 'val3', 'val4', 'val5', 'val6', 'val7', 'val8', 'val9'].filter(k => p[k] !== undefined).map(k => rt.s(p[k])).sort()[0],
    concat_lines_of: p => (arg(p, 'table') || []).map(x => rt.s(x)).join(rt.s(p.sep ?? '')),
    substring: p => { const s = val(p); const off = rt.n(p.off ?? 0); const len = p.len !== undefined ? rt.n(p.len) : s.length - off; if (off < 0 || off + len > s.length) throw rt.new('cx_sy_range_out_of_bounds', { text: 'Substring access out of bounds' }); return s.substr(off, len); },
    substring_after: p => { const s = val(p), sub = rt.s(p.sub); const i = s.indexOf(sub); return i < 0 ? '' : s.slice(i + sub.length); },
    substring_before: p => { const s = val(p), sub = rt.s(p.sub); const i = s.indexOf(sub); return i < 0 ? '' : s.slice(0, i); },
    substring_from: p => { const s = val(p), sub = rt.s(p.sub); const i = s.indexOf(sub); return i < 0 ? '' : s.slice(i); },
    substring_to: p => { const s = val(p), sub = rt.s(p.sub); const i = s.indexOf(sub); return i < 0 ? '' : s.slice(0, i + sub.length); },
    find: p => { const s = val(p); if (p.regex !== undefined || p.pcre !== undefined) { const m = new RegExp(abapRegex(rt.s(p.regex ?? p.pcre)), p.case === '' ? 'i' : '').exec(s); return m ? m.index : -1; } return (p.case === '' ? s.toLowerCase().indexOf(rt.s(p.sub).toLowerCase(), rt.n(p.off ?? 0)) : s.indexOf(rt.s(p.sub), rt.n(p.off ?? 0))); },
    count: p => { const s = val(p); if (p.regex !== undefined || p.pcre !== undefined) return (s.match(new RegExp(abapRegex(rt.s(p.regex ?? p.pcre)), 'g')) || []).length; const sub = rt.s(p.sub); return sub ? s.split(sub).length - 1 : 0; },
    replace: p => { const s = val(p); const all = rt.s(p.occ ?? '1') === '0'; if (p.regex !== undefined || p.pcre !== undefined) return s.replace(new RegExp(abapRegex(rt.s(p.regex ?? p.pcre)), all ? 'g' : ''), rt.s(p.with)); if (p.sub !== undefined) return all ? s.split(rt.s(p.sub)).join(rt.s(p.with)) : s.replace(rt.s(p.sub), rt.s(p.with)); const off = rt.n(p.off ?? 0), len = rt.n(p.len ?? 0); return s.slice(0, off) + rt.s(p.with) + s.slice(off + len); },
    shift_left: p => { const s = val(p); if (p.places !== undefined) return s.slice(rt.n(p.places)); if (p.sub !== undefined) { let r = s; const sub = rt.s(p.sub); while (sub && r.startsWith(sub)) r = r.slice(sub.length); return r; } return s.replace(/^ +/, ''); },
    shift_right: p => { const s = val(p); if (p.places !== undefined) return s.slice(0, Math.max(0, s.length - rt.n(p.places))); if (p.sub !== undefined) { let r = s; const sub = rt.s(p.sub); while (sub && r.endsWith(sub)) r = r.slice(0, -sub.length); return r; } return s.replace(/ +$/, ''); },
    reverse: p => [...val(p)].reverse().join(''),
    repeat: p => val(p).repeat(Math.max(0, rt.n(p.occ))),
    escape: p => escapeAs(val(p), rt.n(p.format)),
    contains: p => { const s = val(p); if (p.regex !== undefined || p.pcre !== undefined) return new RegExp(abapRegex(rt.s(p.regex ?? p.pcre)), p.case === '' ? 'i' : '').test(s); const sub = rt.s(p.sub ?? p.start ?? p.end); if (p.start !== undefined) return s.startsWith(sub); if (p.end !== undefined) return s.endsWith(sub); return p.case === '' ? s.toLowerCase().includes(sub.toLowerCase()) : s.includes(sub); },
    contains_any_of: p => [...rt.s(p.sub)].some(c => val(p).includes(c)),
    matches: p => new RegExp('^(?:' + abapRegex(rt.s(p.regex ?? p.pcre)) + ')$', p.case === '' ? 'i' : '').test(val(p)),
    match: p => { const m = new RegExp(abapRegex(rt.s(p.regex ?? p.pcre))).exec(val(p)); return m ? m[0] : ''; },
    utclong_current: () => new Date().toISOString().replace('Z', '0000'),
    utclong_add: p => rt.utclongAdd(arg(p, 'val'), rt.n(p.days ?? 0) * 86400 + rt.n(p.hours ?? 0) * 3600 + rt.n(p.minutes ?? 0) * 60 + rt.n(p.seconds ?? 0)),
    utclong_diff: p => rt.utclongDiff(p.high, p.low),
    segment: p => { const parts = val(p).split(rt.s(p.sep ?? ' ')); const i = rt.n(p.index); const r = i > 0 ? parts[i - 1] : parts[parts.length + i]; if (r === undefined) throw rt.new('cx_sy_strg_par_val', { text: 'Segment not found' }); return r; },
    insert: p => { const s = val(p); const off = rt.n(p.off ?? 0); return s.slice(0, off) + rt.s(p.sub) + s.slice(off); },
    translate: p => { const from = rt.s(p.from), to = rt.s(p.to); return [...val(p)].map(c => { const i = from.indexOf(c); return i < 0 ? c : (to[i] ?? ''); }).join(''); },
    char_off: p => rt.n(p.off ?? 0) + rt.n(p.add ?? 0),
  };
}
const escRe = s => s.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&');

// ---------------------------------------------------------------------------------- standard classes
function installBuiltinClasses(rt) {
  class AbapObject {}
  AbapObject.$name = 'object';
  rt.classes.set('object', AbapObject);

  class cx_root extends Error {
    $constructor(p = {}) {
      this.textid = p.textid ?? '';
      this.previous = p.previous ?? null;
      for (const [k, v] of Object.entries(p)) if (k !== '$0') this[k] = v;
      return {};
    }
    // the text of a dump or of an uncaught exception: get_text as the class has it (a redefinition reads the
    // attributes its constructor set after super->constructor)
    get message() {
      if (this.$inText) return this.$msg || '';
      this.$inText = true;
      try { const t = this.get_text?.({})?.$ret; return t === undefined || t === null ? (this.$msg || '') : String(t); }
      catch { return this.$msg || ''; }
      finally { this.$inText = false; }
    }
    set message(v) { this.$msg = v; }
    get_text() {
      // a T100 exception (if_t100_message): the text of the message class, &1..&4 from the attributes attr1..attr4 name
      const key = this['if_t100_message~t100key'];
      if (key && typeof key === 'object' && String(key.msgid ?? '').trim()) {
        const arg = a => { const n = String(key[a] ?? '').trim().toLowerCase(); return n ? (this[n] ?? this[`if_t100_dyn_msg~${n}`] ?? '') : ''; };
        return { $ret: rt.msgText(String(key.msgid).trim(), String(key.msgno ?? '').trim(), ['attr1', 'attr2', 'attr3', 'attr4'].map(arg)) };
      }
      return { $ret: this.text ? String(this.text) : (this.$msg || `Exception ${String(this.constructor.$name || 'CX_ROOT').toUpperCase()} was raised`) };
    }
    get_longtext() { return this.get_text(); }
    if_message_get_text() { return this.get_text(); }
  }
  const def = (name, C) => { C.$name = name; rt.classes.set(name, C); return C; };
  def('cx_root', cx_root);
  const cxStatic = def('cx_static_check', class extends cx_root {});
  const cxDyn = def('cx_dynamic_check', class extends cx_root {});
  const cxNo = def('cx_no_check', class extends cx_root {});
  // standard exception classes programs raise themselves
  const cxParam = def('cx_parameter_invalid', class extends cxDyn {});
  def('cx_parameter_invalid_range', class extends cxParam {});
  def('cx_parameter_invalid_type', class extends cxParam {});
  // the CX_SY hierarchy as in ABAP: CATCH cx_sy_arithmetic_error also catches a division by zero or an overflow
  const cxArith = def('cx_sy_arithmetic_error', class extends cxDyn {});
  const cxConv = def('cx_sy_conversion_error', class extends cxDyn {});
  const cxData = def('cx_sy_data_access_error', class extends cxDyn {});
  const cxItab = def('cx_sy_itab_error', class extends cxDyn {});
  for (const n of ['cx_sy_zerodivide', 'cx_sy_arithmetic_overflow', 'cx_sy_precision_loss', 'cx_sy_unsupported_function']) def(n, class extends cxArith {});
  for (const n of ['cx_sy_conversion_no_number', 'cx_sy_conversion_overflow', 'cx_sy_conversion_codepage', 'cx_sy_conversion_rounding',
    'cx_sy_conversion_exact_not_sup', 'cx_sy_conversion_no_date', 'cx_sy_conversion_no_time', 'cx_sy_conversion_no_raw',
    'cx_sy_conversion_lost_decimals', 'cx_sy_conversion_no_boolean', 'cx_sy_conversion_no_uuid', 'cx_sy_unknown_currency']) def(n, class extends cxConv {});
  for (const n of ['cx_sy_range_out_of_bounds', 'cx_sy_offset_not_allowed', 'cx_sy_tab_range_out_of_bounds']) def(n, class extends cxData {});
  for (const n of ['cx_sy_itab_line_not_found', 'cx_sy_itab_duplicate_key']) def(n, class extends cxItab {});
  for (const n of ['cx_sy_move_cast_error', 'cx_sy_regex']) def(n, class extends cxDyn {});
  def('cx_abap_invalid_value', class extends cxStatic {});
  for (const n of ['cx_sy_file_authority', 'cx_sy_file_open_mode', 'cx_sy_file_io', 'cx_sy_dyn_call_illegal_func', 'cx_sy_dyn_call_param_missing', 'cx_sy_ref_is_initial', 'cx_sy_assert', 'cx_sy_open_sql_db', 'cx_sy_dyn_call_illegal_method', 'cx_sy_create_object_error',
    'cx_sy_strg_par_val', 'cx_sy_shortdump']) def(n, class extends cxDyn {});
  def('cx_sy_no_handler', class extends cxNo {});
  def('cx_uuid_error', class extends cxStatic {});
  def('cx_abap_context_info_error', class extends cxStatic {});
  def('cx_bali_runtime', class extends cxStatic {});
  const cxTrafo = def('cx_transformation_error', class extends cxDyn {});
  def('cx_xslt_runtime_error', class extends cxTrafo {});
  def('cx_st_error', class extends cxTrafo {});

  def('cl_abap_behavior_handler', class extends AbapObject {
    new_message_with_text(p = {}) { return { $ret: rt.message({ severity: p.severity, text: p.text ?? '' }) }; }
    new_message(p = {}) { return { $ret: rt.message(p) }; }
  });
  def('cl_abap_behavior_saver', class extends AbapObject {
    finalize() { return {}; } check_before_save() { return {}; } save() { return {}; } cleanup() { return {}; }
    cleanup_finalize() { return {}; } save_modified() { return {}; } adjust_numbers() { return {}; }
    new_message_with_text(p = {}) { return { $ret: rt.message({ severity: p.severity, text: p.text ?? '' }) }; }
    new_message(p = {}) { return { $ret: rt.message(p) }; }
  });
  def('cl_abap_behavior_event_handler', class extends AbapObject {});
  def('cl_abap_behavior_saver_failed', class extends rt.classes.get('cl_abap_behavior_saver') {});
  // message object returned by new_message / new_message_with_text (implements if_abap_behv_message / if_message)
  const Msg = def('$behv_message', class extends AbapObject {
    get_text() { return { $ret: this.text }; }
    get_longtext() { return { $ret: this.text }; }
    ['if_message~get_text']() { return { $ret: this.text }; }
    ['if_message~get_longtext']() { return { $ret: this.text }; }
    toJSON() { return { severity: this.severity, text: this.text }; }
  });
  Msg.$meta = { interfaces: ['if_abap_behv_message', 'if_message', 'if_t100_message'] };

  const iface = (name, consts) => { const I = class {}; I.$name = name; I.$isInterface = true; Object.assign(I, consts); rt.interfaces.set(name, I); };
  iface('if_abap_behv', {
    mk: { on: '01', off: '00' },
    fc: { o: { enabled: '00', disabled: '01' }, f: { unrestricted: '00', read_only: '01', mandatory: '02', all: '00' } },
    auth: { allowed: '00', unauthorized: '01' },
    cause: { not_found: '01', unspecific: '02', unauthorized: '03', locked: '04', readonly: '05', disabled: '06', conflict: '07', dependency: '08' },
    op: { m: { create: 'C', update: 'U', delete: 'D', action: 'A', create_ba: 'B' }, r: { read: 'R', read_ba: 'RB' } },
  });
  iface('if_abap_behv_message', { severity: { error: 'E', warning: 'W', information: 'I', success: 'S', none: '' } });
  iface('if_oo_adt_classrun', {});
  iface('if_oo_adt_classrun_out', {});
  iface('if_message', {});
  iface('if_t100_message', { default_textid: { msgid: '', msgno: '000' } });
  iface('if_t100_dyn_msg', {});
  iface('if_abap_behv_log', {});

  def('cl_abap_context_info', class extends AbapObject {
    static get_system_date() { return { $ret: rt.sy.datum }; }
    static get_system_time() { return { $ret: rt.sy.uzeit }; }
    static get_user_technical_name() { return { $ret: rt.sy.uname }; }
    static get_user_alias() { return { $ret: rt.sy.uname }; }
    static get_user_formatted_name() { return { $ret: rt.authStore?.user(rt.sy.uname)?.fullName || rt.sy.uname }; }
    static get_user_language_abap_format() { return { $ret: 'E' }; }
    static get_system_url() { return { $ret: 'localhost' }; }
  });
  def('cl_system_uuid', class extends AbapObject {
    static create_uuid_x16_static() { return { $ret: randomUUID().replace(/-/g, '').toUpperCase() }; }
    static create_uuid_c32_static() { return { $ret: randomUUID().replace(/-/g, '').toUpperCase() }; }
    static create_uuid_c22_static() { return { $ret: randomUUID().replace(/-/g, '').slice(0, 22).toUpperCase() }; }
    static create_uuid_c36_static() { return { $ret: randomUUID().toUpperCase() }; }
  });
  // arbitrary-size integers and fractions (CL_ABAP_BIGINT, CL_ABAP_RATIONAL) on JS BigInt; operations change the
  // instance and return it (clone( ) makes a copy), as in ABAP
  const first = p => p.$0 !== undefined ? p.$0 : Object.entries(p).find(([k, v]) => !k.startsWith('$') && v !== undefined)?.[1];
  const toBig = v => v instanceof BigI ? v.$v : v instanceof Rat ? v.$n / v.$d : BigInt(Math.trunc(rt.n(v)));
  const bigOf = x => { const o = new BigI(); o.$v = x; return o; };
  const babs = x => (x < 0n ? -x : x);
  const bgcd = (a, b) => { a = babs(a); b = babs(b); while (b) [a, b] = [b, a % b]; return a; };
  const BigI = def('cl_abap_bigint', class extends AbapObject {
    static factory_from_int4(p = {}) { return { $ret: bigOf(BigInt(Math.trunc(rt.n(first(p))))) }; }
    static factory_from_int8(p = {}) { return this.factory_from_int4(p); }
    static factory_from_string(p = {}) { return { $ret: bigOf(BigInt(rt.s(first(p)).trim().replace(/^\+/, ''))) }; }
    to_string() { return { $ret: this.$v.toString() }; }
    to_external(p = {}) { const neg = this.$v < 0n; const d = babs(this.$v).toString(); return { $ret: neg ? (p.iv_flg_minus_in_front === 'X' ? `-${d}` : `${d}-`) : d }; }
    to_utf8() { return { $ret: Buffer.from(this.$v.toString(), 'utf8').toString('hex').toUpperCase() }; }
    to_df34() { return { $ret: Number(this.$v) }; }
    clone() { return { $ret: bigOf(this.$v) }; }
    add(p = {}) { this.$v += toBig(first(p)); return { $ret: this }; }
    add_int4(p = {}) { return this.add(p); }
    sub(p = {}) { this.$v -= toBig(first(p)); return { $ret: this }; }
    sub_int4(p = {}) { return this.sub(p); }
    mul(p = {}) { this.$v *= toBig(first(p)); return { $ret: this }; }
    mul_int4(p = {}) { return this.mul(p); }
    mul_by_two_power(p = {}) { this.$v <<= toBig(first(p)); return { $ret: this }; }
    div_by_two_power(p = {}) { this.$v /= 2n ** toBig(first(p)); return { $ret: this }; }
    // division with a non-negative remainder (as ABAP's DIV and MOD)
    divmod(b) { if (!b) throw rt.new('cx_sy_zerodivide', { text: 'Division by zero' }); let q = this.$v / b, r = this.$v % b; if (r < 0n) { r += babs(b); q = b > 0n ? q - 1n : q + 1n; } return [q, r]; }
    div(p = {}) { const [q, r] = this.divmod(toBig(first(p))); return { $ret: { quotient: bigOf(q), remainder: bigOf(r) } }; }
    div_int4(p = {}) { const [q, r] = this.divmod(toBig(first(p))); return { $ret: { quotient: bigOf(q), remainder: Number(r) } }; }
    div_to_df34(p = {}) { return { $ret: Number(this.$v) / Number(toBig(first(p))) }; }
    mod(p = {}) { this.$v = this.divmod(toBig(first(p)))[1]; return { $ret: this }; }
    mod_int4(p = {}) { return { $ret: Number(this.divmod(toBig(first(p)))[1]) }; }
    pow(p = {}) { this.$v **= toBig(first(p)); return { $ret: this }; }
    sqrt() { let x = this.$v; if (x < 2n) return { $ret: this }; let y = (x + 1n) / 2n; while (y < x) { x = y; y = (x + this.$v / x) / 2n; } this.$v = x; return { $ret: this }; }
    abs() { this.$v = babs(this.$v); return { $ret: this }; }
    gcd(p = {}) { this.$v = bgcd(this.$v, toBig(first(p))); return { $ret: this }; }
    compare(p = {}) { const b = toBig(first(p)); return { $ret: this.$v < b ? -1 : this.$v > b ? 1 : 0 }; }
    compare_int4(p = {}) { return this.compare(p); }
    is_equal(p = {}) { return { $ret: this.$v === toBig(first(p)) ? 'X' : '' }; }
    is_larger(p = {}) { return { $ret: this.$v > toBig(first(p)) ? 'X' : '' }; }
    is_larger_or_equal(p = {}) { return { $ret: this.$v >= toBig(first(p)) ? 'X' : '' }; }
    is_negative() { return { $ret: this.$v < 0n ? 'X' : '' }; }
    is_zero() { return { $ret: this.$v === 0n ? 'X' : '' }; }
    is_int4() { const ok = this.$v >= -2147483648n && this.$v <= 2147483647n; return { $ret: ok ? 'X' : '', ev_int4_value: ok ? Number(this.$v) : 0 }; }
    get_number_of_bits() { return { $ret: babs(this.$v).toString(2).length }; }
  });
  const ratOf = (n, d) => { if (d < 0n) { n = -n; d = -d; } const g = bgcd(n, d) || 1n; const o = new Rat(); o.$n = n / g; o.$d = d / g; return o; };
  const decToRat = txt => { const t = rt.s(txt).trim(); const neg = t.startsWith('-'); const [i, f = ''] = t.replace(/^[+-]/, '').split('.'); return ratOf((neg ? -1n : 1n) * BigInt((i || '0') + f), 10n ** BigInt(f.length)); };
  const ratArg = v => v instanceof Rat ? [v.$n, v.$d] : v instanceof BigI ? [v.$v, 1n] : (() => { const r = decToRat(fmtNumber(rt.n(v))); return [r.$n, r.$d]; })();
  const Rat = def('cl_abap_rational', class extends AbapObject {
    static factory_from_string(p = {}) { const [a, b = '1'] = rt.s(first(p)).trim().split('/'); return { $ret: ratOf(BigInt(a.trim()), BigInt(b.trim())) }; }
    static factory_from_int4(p = {}) { return { $ret: ratOf(BigInt(Math.trunc(rt.n(first(p)))), 1n) }; }
    static factory_from_int8(p = {}) { return this.factory_from_int4(p); }
    static factory_from_bigint(p = {}) { return { $ret: ratOf(first(p).$v, 1n) }; }
    static factory_from_dec(p = {}) { return { $ret: decToRat(fmtNumber(rt.n(first(p)))) }; }
    static factory_from_decimal_string(p = {}) { return { $ret: decToRat(first(p)) }; }
    static factory_from_df34(p = {}) { return { $ret: decToRat(fmtNumber(rt.n(first(p)))) }; }
    to_string() { return { $ret: this.$d === 1n ? this.$n.toString() : `${this.$n}/${this.$d}` }; }
    to_df34() { return { $ret: Number(this.$n) / Number(this.$d) }; }
    to_dec() { const v = Number(this.$n) / Number(this.$d); return { $ret: v, ev_decimal: v }; }
    clone() { return { $ret: ratOf(this.$n, this.$d) }; }
    set(n, d) { const r = ratOf(n, d); this.$n = r.$n; this.$d = r.$d; return { $ret: this }; }
    add(p = {}) { const [n, d] = ratArg(first(p)); return this.set(this.$n * d + n * this.$d, this.$d * d); }
    sub(p = {}) { const [n, d] = ratArg(first(p)); return this.set(this.$n * d - n * this.$d, this.$d * d); }
    mul(p = {}) { const [n, d] = ratArg(first(p)); return this.set(this.$n * n, this.$d * d); }
    div(p = {}) { const [n, d] = ratArg(first(p)); if (!n) throw rt.new('cx_sy_zerodivide', { text: 'Division by zero' }); return this.set(this.$n * d, this.$d * n); }
    add_int4(p) { return this.add(p); } add_bigint(p) { return this.add(p); } sub_int4(p) { return this.sub(p); } sub_bigint(p) { return this.sub(p); }
    mul_int4(p) { return this.mul(p); } mul_bigint(p) { return this.mul(p); } div_int4(p) { return this.div(p); } div_bigint(p) { return this.div(p); }
    abs() { if (this.$n < 0n) this.$n = -this.$n; return { $ret: this }; }
    is_negative() { return { $ret: this.$n < 0n ? 'X' : '' }; }
    is_zero() { return { $ret: this.$n === 0n ? 'X' : '' }; }
  });
  // value ranges of the numeric types
  const math = def('cl_abap_math', class extends AbapObject {});
  Object.assign(math, { round_half_up: 1, round_half_down: 2, round_half_even: 3, round_up: 4, round_down: 5, round_ceiling: 6, round_floor: 7, max_int1: 255, min_int1: 0, max_int2: 32767, min_int2: -32768, max_int4: 2147483647, min_int4: -2147483648,
    max_int8: 9223372036854775807, min_int8: -9223372036854775808, max_decfloat16: 9.999999999999999e384, min_decfloat16: 1e-383,
    max_decfloat34: Number.MAX_VALUE, min_decfloat34: Number.MIN_VALUE, max_float: Number.MAX_VALUE, min_float: Number.MIN_VALUE });
  // the formats of escape( val = … format = cl_abap_format=>e_… )
  def('cl_abap_format', class extends AbapObject {});
  Object.assign(rt.cls('cl_abap_format'), ESCAPE_FORMATS);
  const chars = def('cl_abap_char_utilities', class extends AbapObject {});
  Object.assign(chars, { newline: '\n', horizontal_tab: '\t', cr_lf: '\r\n', form_feed: '\f', backspace: '\b' });
  // random numbers (CL_ABAP_RANDOM and the typed generators CL_ABAP_RANDOM_INT, _INT8, _FLOAT, _PACKED, _PACKED_DECn,
  // _DECFLOAT16/34): a seeded generator (mulberry32), so the same seed gives the same numbers
  const prng = seed => { let a = (Number(seed) >>> 0) || 0x9e3779b9; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
  const seedOf = p => p.seed !== undefined && p.seed !== '' && p.seed !== null ? rt.n(p.seed) : Math.floor(Math.random() * 2147483647);
  def('cl_abap_random', class extends AbapObject {
    static seed() { return { $ret: Math.floor(Math.random() * 2147483647) }; }
    static create(p = {}) { const o = new (rt.cls('cl_abap_random'))(); o.$r = prng(seedOf(p)); return { $ret: o }; }
    int() { return { $ret: Math.floor(this.$r() * 2147483647) }; }
    int31() { return this.int(); }
    intinrange(p = {}) { const lo = rt.n(p.low ?? 0), hi = rt.n(p.high ?? 2147483647); return { $ret: lo + Math.floor(this.$r() * (hi - lo + 1)) }; }
    float() { return { $ret: this.$r() }; }
    packed() { return { $ret: Math.floor(this.$r() * 1e15) }; }
    packedinrange(p = {}) { return this.intinrange({ low: p.min ?? p.low, high: p.max ?? p.high }); }
    decfloat16() { return { $ret: Number(this.$r().toPrecision(16)) }; }
    decfloat34() { return { $ret: this.$r() }; }
  });
  // CL_ABAP_RANDOM_<type>=>create( seed min max )->get_next( ) (and get_next_..._array where present)
  const gen = (name, next) => def(name, class extends AbapObject {
    static create(p = {}) {
      const o = new (rt.cls(name))();
      o.$r = prng(seedOf(p)); o.min = p.min !== undefined ? rt.n(p.min) : undefined; o.max = p.max !== undefined ? rt.n(p.max) : undefined;
      return { $ret: o };
    }
    get_next() { return { $ret: next(this) }; }
  });
  const inRange = (o, lo, hi) => { const a = o.min ?? lo, b = o.max ?? hi; return a + Math.floor(o.$r() * (b - a + 1)); };
  gen('cl_abap_random_int', o => inRange(o, 0, 2147483647));
  gen('cl_abap_random_int1', o => inRange(o, 0, 255));
  gen('cl_abap_random_int2', o => inRange(o, -32768, 32767));
  gen('cl_abap_random_int8', o => inRange(o, 0, Number.MAX_SAFE_INTEGER));
  gen('cl_abap_random_float', o => (o.min ?? 0) + o.$r() * ((o.max ?? 1) - (o.min ?? 0)));
  gen('cl_abap_random_decfloat16', o => Number(((o.min ?? 0) + o.$r() * ((o.max ?? 1) - (o.min ?? 0))).toPrecision(16)));
  gen('cl_abap_random_decfloat34', o => (o.min ?? 0) + o.$r() * ((o.max ?? 1) - (o.min ?? 0)));
  gen('cl_abap_random_packed', o => inRange(o, -999999999999999, 999999999999999));
  for (let d = 1; d <= 14; d++) gen(`cl_abap_random_packed_dec${d}`, o => rt.round((o.min ?? -(10 ** (15 - d))) + o.$r() * ((o.max ?? 10 ** (15 - d)) - (o.min ?? -(10 ** (15 - d)))), d));
  // custom entities: if_rap_query_provider~select( io_request, io_response ) — request and response objects
  def('cx_rap_query_provider', class extends cxStatic {});
  def('cx_rap_query_filter_no_range', class extends cxStatic {});
  def('cx_rap_query_response_set_twic', class extends cxStatic {});
  iface('if_rap_query_provider', {});
  iface('if_rap_query_request', {});
  iface('if_rap_query_response', {});
  iface('if_rap_query_filter', {});
  iface('if_rap_query_paging', { page_size_unlimited: -1 });
  iface('if_rap_query_aggregation', {});
  const meta = (C, ...interfaces) => { C.$meta = { interfaces }; for (const i of interfaces) for (const m of Object.getOwnPropertyNames(C.prototype)) if (m !== 'constructor' && !m.includes('~')) C.prototype[`${i}~${m}`] = C.prototype[m]; return C; };
  const QPaging = meta(def('$rap_query_paging', class extends AbapObject {
    get_offset() { return { $ret: this.offset }; }
    get_page_size() { return { $ret: this.size }; }
  }), 'if_rap_query_paging');
  const QFilter = meta(def('$rap_query_filter', class extends AbapObject {
    get_as_sql_string() { return { $ret: this.sql }; }
    get_as_ranges() {
      if (this.ranges === null) throw rt.new('cx_rap_query_filter_no_range', { text: 'The filter cannot be converted into ranges' });
      return { $ret: this.ranges.map(r => ({ name: r.name, range: r.range.map(x => ({ ...x })) })) };
    }
  }), 'if_rap_query_filter');
  const QAgg = meta(def('$rap_query_aggregation', class extends AbapObject {
    get_aggregated_elements() { return { $ret: [] }; }
    get_grouped_elements() { return { $ret: [] }; }
  }), 'if_rap_query_aggregation');
  meta(def('$rap_query_request', class extends AbapObject {
    get_paging() { const p = new QPaging(); p.offset = this.spec.offset; p.size = this.spec.size; return { $ret: p }; }
    get_filter() { const f = new QFilter(); f.sql = this.spec.filterSql; f.ranges = this.spec.ranges; return { $ret: f }; }
    get_sort_elements() { return { $ret: this.spec.sort.map(s => ({ element_name: s.name, descending: s.desc ? 'X' : '' })) }; }
    get_requested_elements() { return { $ret: [...this.spec.elements] }; }
    get_search_expression() { return { $ret: this.spec.search || '' }; }
    get_parameters() { return { $ret: (this.spec.params || []).map(p => ({ parameter_name: p.name, value: p.value })) }; }
    get_entity_id() { return { $ret: this.spec.entity }; }
    get_aggregation() { return { $ret: new QAgg() }; }
    is_data_requested() { return { $ret: this.spec.data ? 'X' : '' }; }
    is_total_numb_of_rec_requested() { return { $ret: this.spec.count ? 'X' : '' }; }
  }), 'if_rap_query_request');
  meta(def('$rap_query_response', class extends AbapObject {
    set_data(p = {}) {
      if (this.data) throw rt.new('cx_rap_query_response_set_twic', { text: 'set_data was called twice' });
      this.data = rt.clone(p.it_data ?? p.$0 ?? []); return {};
    }
    set_total_number_of_records(p = {}) { this.total = rt.n(p.iv_total_number_of_records ?? p.$0); return {}; }
  }), 'if_rap_query_response');
  rt.queryRequest = spec => { const r = new (rt.cls('$rap_query_request'))(); r.spec = spec; return r; };
  rt.queryResponse = () => new (rt.cls('$rap_query_response'))();

  // ---- ABAP Unit
  const aunit = def('cx_aunit_failure', class extends cxNo {});
  def('cx_aunit_skip', class extends cxNo {});
  const show = v => (v !== null && typeof v === 'object' ? JSON.stringify(v) : rt.s(v));
  // references (object instances, data references) are equal only when they point to the same object; structures
  // and tables compare by value
  const isRef = v => v !== null && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) !== Object.prototype && Object.getPrototypeOf(v) !== null;
  const same = (a, b) => {
    if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => same(x, b[i]));
    if (isRef(a) || isRef(b)) return a === b;
    if (a && b && typeof a === 'object' && typeof b === 'object') return [...new Set([...Object.keys(a), ...Object.keys(b)])].filter(k => !k.startsWith('$')).every(k => same(a[k], b[k]));
    return rt.eq(a, b);
  };
  const fail = (p, what) => { throw rt.new('cx_aunit_failure', { text: `${what}${p.msg !== undefined && rt.s(p.msg) ? `: ${rt.s(p.msg)}` : ''}` }); };
  const initialish = v => (v === null || v === undefined || (Array.isArray(v) ? !v.length : typeof v === 'object' ? Object.values(v).every(initialish) : rt.initial(v)));
  def('cl_abap_unit_assert', class extends AbapObject {
    static assert_equals(p = {}) {
      const ok = p.tol !== undefined ? Math.abs(rt.n(p.act) - rt.n(p.exp)) <= rt.n(p.tol) : same(p.act, p.exp);
      if (!ok) fail(p, `Expected [${show(p.exp)}] Actual [${show(p.act)}]`);
      return { $ret: 'X' };
    }
    static assert_differs(p = {}) { if (same(p.act, p.exp)) fail(p, `Expected a value different from [${show(p.exp)}]`); return { $ret: 'X' }; }
    static assert_true(p = {}) { const v = p.act ?? p.$0; if (!(v === 'X' || v === true)) fail(p, 'Expected true'); return { $ret: 'X' }; }
    static assert_false(p = {}) { const v = p.act ?? p.$0; if (v === 'X' || v === true) fail(p, 'Expected false'); return { $ret: 'X' }; }
    static assert_initial(p = {}) { if (!initialish(p.act ?? p.$0)) fail(p, `Expected initial value, Actual [${show(p.act ?? p.$0)}]`); return { $ret: 'X' }; }
    static assert_not_initial(p = {}) { if (initialish(p.act ?? p.$0)) fail(p, 'Expected a non-initial value'); return { $ret: 'X' }; }
    static assert_bound(p = {}) { if ((p.act ?? p.$0) == null) fail(p, 'Expected a bound reference'); return { $ret: 'X' }; }
    static assert_not_bound(p = {}) { if ((p.act ?? p.$0) != null) fail(p, 'Expected an unbound reference'); return { $ret: 'X' }; }
    static assert_subrc(p = {}) { const exp = rt.n(p.exp ?? 0), act = rt.n(p.act ?? rt.sy.subrc); if (exp !== act) fail(p, `Expected sy-subrc ${exp}, Actual ${act}`); return { $ret: 'X' }; }
    static assert_return_code(p = {}) { return this.assert_subrc(p); }
    static assert_char_cp(p = {}) { const re = new RegExp('^' + rt.s(p.exp).replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$', 'i'); if (!re.test(rt.s(p.act))) fail(p, `[${rt.s(p.act)}] does not match pattern [${rt.s(p.exp)}]`); return { $ret: 'X' }; }
    static assert_char_np(p = {}) { const re = new RegExp('^' + rt.s(p.exp).replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$', 'i'); if (re.test(rt.s(p.act))) fail(p, `[${rt.s(p.act)}] matches pattern [${rt.s(p.exp)}]`); return { $ret: 'X' }; }
    static assert_text_matches(p = {}) { if (!new RegExp(rt.s(p.pattern)).test(rt.s(p.text))) fail(p, `[${rt.s(p.text)}] does not match [${rt.s(p.pattern)}]`); return { $ret: 'X' }; }
    static assert_table_contains(p = {}) { if (!(p.table || []).some(r => same(r, p.line))) fail(p, `Table does not contain [${show(p.line)}]`); return { $ret: 'X' }; }
    static assert_table_not_contains(p = {}) { if ((p.table || []).some(r => same(r, p.line))) fail(p, `Table contains [${show(p.line)}]`); return { $ret: 'X' }; }
    static assert_number_between(p = {}) { const n = rt.n(p.number); if (n < rt.n(p.lower) || n > rt.n(p.upper)) fail(p, `${n} is not between ${rt.n(p.lower)} and ${rt.n(p.upper)}`); return { $ret: 'X' }; }
    static fail(p = {}) { throw rt.new('cx_aunit_failure', { text: rt.s(p.msg ?? p.$0 ?? 'Failed') }); }
    static abort(p = {}) { throw rt.new('cx_aunit_failure', { text: rt.s(p.msg ?? p.$0 ?? 'Aborted') }); }
    static skip(p = {}) { throw rt.new('cx_aunit_skip', { text: rt.s(p.msg ?? p.$0 ?? 'Skipped') }); }
  });
  void aunit;

  // ---- test doubles for ABAP SQL and CDS: run inside the test's rolled-back database transaction,
  // so emptying the real tables and inserting test data is safe (everything is undone after each test)
  const tableFor = (names, rows) => {
    const m = rt.model;
    const cols = new Set(Object.keys(rows[0] || {}).map(k => k.toLowerCase()));
    return names.find(n => { const t = m.tables.get(n) || m.entities.get(n); return t && [...cols].every(c => t.fields.some(f => f.name === c)); });
  };
  const baseTables = (name, seen = new Set()) => {
    const m = rt.model;
    if (seen.has(name)) return [];
    seen.add(name);
    if (m.tables.has(name)) return [name];
    const e = m.entities.get(name);
    if (!e?.def) return [];
    const srcs = [e.def.from?.name, ...(e.def.joins || []).map(j => j.name)].filter(Boolean);
    return srcs.flatMap(s => baseTables(s, seen));
  };
  // rows for a table or for a view that maps its elements 1:1 to one table
  const insertRows = (target, rows) => {
    const m = rt.model;
    let table = target, map = null;
    if (!m.tables.has(target)) {
      const e = m.entities.get(target);
      const bt = baseTables(target);
      if (bt.length !== 1) throw rt.new('cx_sy_open_sql_db', { text: `Test data for ${target.toUpperCase()}: insert into its tables instead` });
      table = bt[0];
      map = Object.fromEntries((e.fields || []).map(f => [f.name, f.basePath || f.name]));
    }
    const data = rows.map(r => Object.fromEntries(Object.entries(r).map(([k, v]) => [map ? (map[k.toLowerCase()] || k.toLowerCase()) : k.toLowerCase(), v])));
    rt.sql.modify(table, data);
  };
  const env = (name, deps) => {
    const E = def(name, class extends AbapObject {
      clear_doubles() { for (const t of [...new Set(this.deps.flatMap(d => baseTables(d)))]) rt.sql.db.exec(`DELETE FROM "${t}"`); return {}; }
      insert_test_data(p = {}) {
        const rows = rt.clone(p.i_data ?? p.$0 ?? []);
        if (!rows.length) return {};
        const target = p.i_named_as ? rt.s(p.i_named_as).toLowerCase() : tableFor(this.deps.flatMap(d => [d, ...baseTables(d)]), rows);
        if (!target) throw rt.new('cx_sy_open_sql_db', { text: 'Test data matches none of the doubled tables; pass i_named_as' });
        insertRows(target, rows);
        return {};
      }
      get_double(p = {}) { const self = this, n = rt.s(p.i_name ?? p.$0).toLowerCase(); return { $ret: { insert(q = {}) { insertRows(n, rt.clone(q.i_test_data?.data ?? q.$0?.data ?? q.i_test_data ?? [])); return {}; }, deleteAll() { self.clear_doubles(); return {}; } } }; }
      enable_double_redirection() { return {}; }
      disable_double_redirection() { return {}; }
      destroy() { return {}; }
    });
    E.$meta = { interfaces: [deps] };
    return E;
  };
  const Osql = env('cl_osql_test_environment', 'if_osql_test_environment');
  Osql.create = (p = {}) => { const o = new Osql(); o.deps = (p.i_dependency_list ?? p.$0 ?? []).map(d => rt.s(typeof d === 'object' ? Object.values(d)[0] : d).toLowerCase()); o.clear_doubles(); return { $ret: o }; };
  const Cds = env('cl_cds_test_environment', 'if_cds_test_environment');
  Cds.create = (p = {}) => {
    const o = new Cds();
    const e = rt.model.entities.get(rt.s(p.i_for_entity ?? p.$0).toLowerCase());
    o.deps = e?.def ? [e.def.from?.name, ...(e.def.joins || []).map(j => j.name)].filter(Boolean) : [];
    o.clear_doubles();
    return { $ret: o };
  };
  Cds.create_for_multiple_cds = (p = {}) => { const o = new Cds(); o.deps = (p.i_for_entities || []).flatMap(x => { const e = rt.model.entities.get(rt.s(x.i_for_entity ?? x).toLowerCase()); return e?.def ? [e.def.from?.name, ...(e.def.joins || []).map(j => j.name)] : []; }).filter(Boolean); o.clear_doubles(); return { $ret: o }; };
  def('cl_cds_test_data', class extends AbapObject { static create(p = {}) { return { $ret: { data: rt.clone(p.i_data ?? p.$0 ?? []) } }; } });
  iface('if_osql_test_environment', {});
  iface('if_cds_test_environment', {});

  // ---- RTTS: type descriptions. Values carry no declared type at runtime, so describe_by_data infers it
  // (numbers: I / P, text: g, objects: structure, arrays: table); describe_by_name knows tables and CDS entities.
  const TK = { c: 'C', n: 'N', d: 'D', t: 'T', i: 'I', int8: '8', p: 'P', f: 'F', string: 'g', x: 'X', xstring: 'y', uuid: 'X', tsl: 'P', ts: 'P', bool: 'C', clnt: 'C', utclong: 'p' };
  const Type = def('cl_abap_typedescr', class extends AbapObject {
    static describe_by_data(p = {}) { return { $ret: p.$type ? describeSpec(p.$type, p.p_data ?? p.$0) : describe(p.p_data ?? p.$0) }; }
    static describe_by_data_ref(p = {}) { return { $ret: describe(rt.deref(p.p_data_ref ?? p.$0)) }; }
    static describe_by_object_ref(p = {}) { return { $ret: describeObject(p.p_object_ref ?? p.$0) }; }
    static describe_by_name(p = {}) {
      const n = rt.s(p.p_name ?? p.$0).toLowerCase().replace(/^\\type=/, '');
      const m = rt.model;
      const t = m?.tables.get(n) || m?.entities.get(n);
      if (t) return { $ret: structOf(t.fields.map(f => ({ name: f.name.toUpperCase(), d: elem(TK[f.ti.t] || 'C', f.ti.len || 0, f.ti.dec || 0) })), n) };
      if (rt.hasClass(n)) return { $ret: describeObject(null, n) };
      const elemTypes = { string: 'g', i: 'I', int8: '8', d: 'D', t: 'T', f: 'F', xstring: 'y', abap_bool: 'C', utclong: 'p' };
      if (elemTypes[n]) return { $ret: elem(elemTypes[n], n === 'abap_bool' ? 1 : 0, 0, n) };
      throw rt.new('cx_sy_dyn_call_illegal_method', { text: `Type ${n.toUpperCase()} not found` });
    }
    get_relative_name() { return { $ret: this.relative_name }; }
    is_ddic_type() { return { $ret: this.ddic ? 'X' : '' }; }
  });
  Object.assign(Type, { kind_elem: 'E', kind_struct: 'S', kind_table: 'T', kind_ref: 'R', kind_class: 'C', kind_intf: 'I',
    typekind_char: 'C', typekind_string: 'g', typekind_int: 'I', typekind_int8: '8', typekind_packed: 'P', typekind_date: 'D', typekind_time: 'T',
    typekind_num: 'N', typekind_hex: 'X', typekind_xstring: 'y', typekind_float: 'F', typekind_struct1: 'u', typekind_struct2: 'v', typekind_table: 'h',
    typekind_oref: 'r', typekind_dref: 'l', typekind_utclong: 'p' });
  const Data = def('cl_abap_datadescr', class extends Type {});
  const Elem = def('cl_abap_elemdescr', class extends Data {
    static get_string() { return { $ret: elem('g', 0, 0, 'string') }; }
    static get_i() { return { $ret: elem('I', 4, 0, 'i') }; }
    static get_int8() { return { $ret: elem('8', 8, 0, 'int8') }; }
    static get_d() { return { $ret: elem('D', 8, 0, 'd') }; }
    static get_t() { return { $ret: elem('T', 6, 0, 't') }; }
    static get_f() { return { $ret: elem('F', 8, 0, 'f') }; }
    static get_xstring() { return { $ret: elem('y', 0, 0, 'xstring') }; }
    static get_c(p = {}) { return { $ret: elem('C', rt.n(p.p_length ?? p.$0 ?? 1), 0, 'c') }; }
    static get_n(p = {}) { return { $ret: elem('N', rt.n(p.p_length ?? p.$0 ?? 1), 0, 'n') }; }
    static get_x(p = {}) { return { $ret: elem('X', rt.n(p.p_length ?? p.$0 ?? 1), 0, 'x') }; }
    static get_p(p = {}) { return { $ret: elem('P', rt.n(p.p_length ?? 8), rt.n(p.p_decimals ?? 0), 'p') }; }
  });
  const Struct = def('cl_abap_structdescr', class extends Data {
    static get(p = {}) { return { $ret: structOf((p.p_components ?? p.$0 ?? []).map(c => ({ name: rt.s(c.name).toUpperCase(), d: c.type }))) }; }
    static create(p = {}) { return this.get(p); }
    get_components() { return { $ret: this.$comps.map(c => ({ name: c.name, type: c.d, as_include: '', suffix: '' })) }; }
    get_component_type(p = {}) { const c = this.$comps.find(x => x.name === rt.s(p.p_name ?? p.$0).toUpperCase()); if (!c) throw rt.new('cx_sy_dyn_call_illegal_method', { text: 'Component not found' }); return { $ret: c.d }; }
    get_ddic_field_list() { return { $ret: this.$comps.map(c => ({ fieldname: c.name, inttype: c.d.type_kind, leng: c.d.length, decimals: c.d.decimals })) }; }
  });
  const Table = def('cl_abap_tabledescr', class extends Data {
    static get(p = {}) { return { $ret: tableOf(p.p_line_type ?? p.$0) }; }
    static create(p = {}) { return this.get(p); }
    get_table_line_type() { return { $ret: this.$line }; }
  });
  Object.assign(Table, { tablekind_std: 'S', tablekind_sorted: 'O', tablekind_hashed: 'H' });
  const Ref = def('cl_abap_refdescr', class extends Data { get_referenced_type() { return { $ret: this.$target }; } });
  const Obj = def('cl_abap_classdescr', class extends Type {
    // the superclass (OBJECT at the root); OBJECT itself has none: classic exception SUPER_CLASS_NOT_FOUND
    get_super_class_type() { if (this.relative_name === 'OBJECT') throw rt.classicException('super_class_not_found'); return { $ret: describeObject(null, this.$super || 'object') }; }
  });
  def('cl_abap_objectdescr', Obj);
  Object.assign(Obj, { exporting: 'E', importing: 'I', changing: 'C', receiving: 'R', returning: 'R' });
  def('cl_abap_intfdescr', class extends Type {});
  function elem(tk, len, dec, name = '') { const d = new Elem(); Object.assign(d, { kind: 'E', type_kind: tk, length: len, decimals: dec, output_length: len, absolute_name: name ? `\\TYPE=${name.toUpperCase()}` : '', relative_name: name.toUpperCase() }); return d; }
  function structOf(comps, name = '') {
    const d = new Struct();
    d.$comps = comps;
    Object.assign(d, { kind: 'S', type_kind: 'v', struct_kind: 'F', absolute_name: name ? `\\TYPE=${name.toUpperCase()}` : '', relative_name: name.toUpperCase(), ddic: !!name,
      components: comps.map(c => ({ name: c.name, type_kind: c.d.type_kind, length: c.d.length, decimals: c.d.decimals })) });
    return d;
  }
  function tableOf(line) { const d = new Table(); d.$line = line; Object.assign(d, { kind: 'T', type_kind: 'h', table_kind: 'S', has_unique_key: '', key: [], absolute_name: '', relative_name: '' }); return d; }
  function describeObject(o, name) {
    const C = name ? rt.cls(name) : o?.constructor;
    const d = new Obj();
    const cn = String(C?.$name || 'object');
    const meta = rt.model?.classes.get(cn);
    Object.assign(d, { kind: C?.$isInterface ? 'I' : 'C', type_kind: 'r', absolute_name: `\\CLASS=${cn.toUpperCase()}`, relative_name: cn.toUpperCase(),
      methods: meta ? [...meta.methods.values()].map(m => ({ name: m.name.toUpperCase(), is_class: m.static ? 'X' : '' })) : [],
      attributes: meta ? meta.attrs.map(a => ({ name: a.name.toUpperCase(), is_class: a.static ? 'X' : '', is_constant: a.kind === 'constant' ? 'X' : '' })) : [],
      interfaces: meta ? meta.interfaces.map(i => ({ name: i.toUpperCase() })) : [] });
    d.$super = meta?.superName;
    return d;
  }
  // from the declared type (the compiler passes it); parts it does not know are described from the value
  const SPEC_KIND = { i: ['I', 4], int8: ['8', 8], p: ['P'], f: ['F', 8], decfloat16: ['a', 8], decfloat34: ['e', 16], c: ['C'], n: ['N'], x: ['X'],
    string: ['g', 8], xstring: ['y', 8], d: ['D', 16], t: ['T', 12], utclong: ['p', 8] };
  function describeSpec(t, v) {
    if (!t) return describe(v);
    if (t.k === 'struct') return structOf(Object.entries(t.comps).map(([k, c]) => ({ name: k.toUpperCase(), d: describeSpec(c, v?.[k]) })));
    if (t.k === 'table') return tableOf(t.line ? describeSpec(t.line, Array.isArray(v) ? v[0] : undefined) : Array.isArray(v) && v.length ? describe(v[0]) : elem('C', 0, 0));
    const [tk, len] = SPEC_KIND[t.k] || [];
    if (!tk) return describe(v);
    const bytes = t.k === 'c' || t.k === 'n' ? 2 * t.len : len ?? t.len;   // length in bytes (Unicode: 2 per character)
    const d = elem(tk, bytes, t.dec ?? 0, ['c', 'n', 'x', 'p'].includes(t.k) ? '' : t.k);
    d.output_length = t.k === 'c' || t.k === 'n' || t.k === 'x' ? t.len : d.output_length;
    return d;
  }
  rt.describeSpec = describeSpec;
  function describe(v) {
    if (Array.isArray(v)) return tableOf(v.length ? describe(v[0]) : elem('C', 0, 0));
    if (v instanceof AbapObject) { const r = new Ref(); Object.assign(r, { kind: 'R', type_kind: 'r', absolute_name: '', relative_name: '' }); r.$target = describeObject(v); return r; }
    if (v && typeof v === 'object') return structOf(Object.entries(v).filter(([k]) => !k.startsWith('$') && !k.startsWith('%')).map(([k, x]) => ({ name: k.toUpperCase(), d: describe(x) })));
    if (typeof v === 'number') return Number.isInteger(v) ? elem('I', 4, 0, 'i') : elem('P', 16, String(v).split('.')[1]?.length || 0, 'p');
    return elem('g', 0, 0, 'string');
  }
  rt.initialOfDescr = function initialOfDescr(d) {
    if (!d) return '';
    if (d.kind === 'S') return Object.fromEntries(d.$comps.map(c => [c.name.toLowerCase(), initialOfDescr(c.d)]));
    if (d.kind === 'T') return [];
    if (d.kind === 'R') return null;
    return ['I', '8', 'P', 'F'].includes(d.type_kind) ? 0 : d.type_kind === 'N' ? '0'.repeat(d.length) : d.type_kind === 'D' ? '00000000' : d.type_kind === 'T' ? '000000' : '';
  };

  // sXML writers for CALL TRANSFORMATION ... RESULT XML writer
  iface('if_sxml', { co_xt_json: 'json', co_xt_xml10: 'xml' });
  const SxmlW = def('cl_sxml_string_writer', class extends AbapObject {
    static create(p = {}) { const w = new SxmlW(); w.$writer = true; w.type = rt.s(p.type ?? 'xml'); w.output = ''; return { $ret: w }; }
    get_output() { return { $ret: this.output }; }
  });
  SxmlW.$meta = { interfaces: ['if_sxml_writer'] };
  // /UI2/CL_JSON: serialize / deserialize
  const Json = def('/ui2/cl_json', class extends AbapObject {
    static serialize(p = {}) {
      const mode = rt.s(p.pretty_name ?? '');
      const name = k => (mode === 'X' || mode === 'Y' ? k.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase()) : mode === 'L' ? k.toLowerCase() : k.toUpperCase());
      const compress = p.compress === 'X' || p.compress === true;
      const conv = v => {
        if (Array.isArray(v)) return v.map(conv);
        if (v && typeof v === 'object') { const o = {}; for (const [k, x] of Object.entries(v)) { if (k.startsWith('%') || k.startsWith('$')) continue; if (compress && (x === '' || x === 0 || (Array.isArray(x) && !x.length))) continue; o[name(k)] = conv(x); } return o; }
        if (v === 'X' && p.pretty_name !== undefined) return true;
        return v;
      };
      return { $ret: JSON.stringify(conv(p.data ?? p.$0)) };
    }
    static deserialize(p = {}) {
      const text = rt.s(p.json ?? p.$0 ?? '');
      let parsed;
      try { parsed = text ? JSON.parse(text) : null; } catch { parsed = null; }
      const norm = k => k.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
      const into = (shape, v) => {
        if (Array.isArray(shape) || (Array.isArray(v) && (shape === undefined || shape === ''))) { const line = Array.isArray(shape) ? shape.$line : undefined; return (Array.isArray(v) ? v : []).map(x => into(line ? rt.clone(line) : undefined, x)); }
        if (shape && typeof shape === 'object') { const o = rt.clone(shape); if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { const key = Object.keys(o).find(z => z === k.toLowerCase() || z === norm(k)); if (key) o[key] = into(o[key], x); } return o; }
        if (v && typeof v === 'object') { const o = {}; for (const [k, x] of Object.entries(v)) o[norm(k)] = into(undefined, x); return o; }
        return v === true ? 'X' : v === false ? '' : v ?? shape;
      };
      return { data: into(p.data, parsed) };
    }
  });
  Object.assign(Json, { pretty_mode: { none: '', low_case: 'L', camel_case: 'X', extended: 'Y', user: 'U', user_low_case: 'C' } });

  // time stamps (YYYYMMDDhhmmss[.fffffff] as numbers) and utclong (ISO text with 7 decimals of seconds)
  const tsMs = ts => { const x = rt.n(ts); return tsToDate(Math.floor(x)).getTime() + Math.round((x - Math.floor(x)) * 1000); };
  const msTs = (ms, long) => { const d = new Date(ms); const base = dateToTs(new Date(Math.floor(ms / 1000) * 1000)); return long ? Number(`${base}.${String(d.getUTCMilliseconds()).padStart(3, '0')}`) : base; };
  const utcMs = u => { const d = parseUtclong(u); if (!d) return null; const f = /\.(\d+)/.exec(String(u)); return d.getTime() + (f ? Math.round(Number(`0.${f[1]}`) * 1000) : 0); };
  const msUtc = ms => { const d = new Date(ms); const p = (n, l = 2) => String(n).padStart(l, '0'); return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}T${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}.${p(d.getUTCMilliseconds(), 3)}0000`; };
  rt.utclongAdd = (u, secs) => { const ms = utcMs(u); return ms === null ? u : msUtc(ms + secs * 1000); };
  rt.utclongDiff = (hi, lo) => (utcMs(hi) - utcMs(lo)) / 1000;
  def('cl_abap_tstmp', class extends AbapObject {
    static add(p = {}) { return { $ret: msTs(tsMs(p.tstmp) + rt.n(p.secs) * 1000, !Number.isInteger(rt.n(p.tstmp)) || !Number.isInteger(rt.n(p.secs))) }; }
    static subtractsecs(p = {}) { return { $ret: msTs(tsMs(p.tstmp) - rt.n(p.secs) * 1000, !Number.isInteger(rt.n(p.tstmp))) }; }
    static subtract(p = {}) { return { $ret: (tsMs(p.tstmp1) - tsMs(p.tstmp2)) / 1000 }; }
    static move_to_short(p = {}) { return { $ret: Math.floor(rt.n(p.tstmp_src ?? p.$0)) }; }
    static move(p = {}) { return { $ret: rt.n(p.tstmp_src ?? p.$0), tstmp_tgt: rt.n(p.tstmp_src ?? p.$0) }; }
    static normalize(p = {}) { return { $ret: msTs(tsMs(p.tstmp_in ?? p.$0), true) }; }
    static utclong2tstmp(p = {}) { const ms = utcMs(p.utclong ?? p.$0); return { $ret: ms === null ? 0 : msTs(ms, true) }; }
    static utclong2tstmp_short(p = {}) { const ms = utcMs(p.utclong ?? p.$0); return { $ret: ms === null ? 0 : msTs(ms, false) }; }
    static tstmp2utclong(p = {}) { return { $ret: msUtc(tsMs(p.timestamp ?? p.$0)) }; }
    static td_add(p = {}) { const d = tsToDate(`${rt.s(p.date)}${rt.s(p.time)}`); d.setTime(d.getTime() + rt.n(p.secs) * 1000); const t = String(dateToTs(d)); return { $ret: '', res_date: t.slice(0, 8), res_time: t.slice(8) }; }
  });
  def('cl_abap_utclong', class extends AbapObject {
    // diff( high low ): days, hours, minutes, seconds of the difference
    static diff(p = {}) {
      let sec = (utcMs(p.high) - utcMs(p.low)) / 1000;
      const sign = sec < 0 ? -1 : 1; sec = Math.abs(sec);
      const days = Math.floor(sec / 86400), hours = Math.floor(sec % 86400 / 3600), minutes = Math.floor(sec % 3600 / 60), seconds = sec % 60;
      return { $ret: '', days: sign * days, hours: sign * hours, minutes: sign * minutes, seconds: sign * seconds };
    }
    static read(p = {}) { const ms = utcMs(rt.s(p.string ?? p.$0).trim()); if (ms === null) throw rt.new('cx_abap_utclong_invalid', { text: `Invalid time stamp ${rt.s(p.string ?? p.$0)}` }); return { $ret: msUtc(ms), value: msUtc(ms) }; }
  });
  def('cx_abap_utclong_invalid', class extends cxStatic {});

  // ---- XCO (the ABAP Cloud standard library), core: xco_cp=>sy, xco_cp_time (dates, times, moments, formats, time
  // zones, date calculation), xco_cp=>string, xco_cp=>current->call_stack
  def('cx_xco_runtime_exception', class extends cxDyn {});
  const pad = (n, l = 2) => String(n).padStart(l, '0');
  const fmtTok = name => ({ $xcoFormat: name });
  const FORMATS = { iso_8601_extended: fmtTok('ext'), iso_8601_basic: fmtTok('basic'), abap: fmtTok('abap') };
  const zoneTok = (value) => ({ value });
  const ZONES = { utc: zoneTok('UTC'), user: zoneTok('UTC') };
  const CALC = { preserving: { $calc: 'preserving' }, ultimo: { $calc: 'ultimo' } };
  const lastDay = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
  const XDate = def('cl_xco_cp_date', class extends AbapObject {
    static of(y, m, d) { const o = new XDate(); Object.assign(o, { year: pad(y, 4), month: pad(m), day: pad(d) }); return o; }
    get $ymd() { return [Number(this.year), Number(this.month), Number(this.day)]; }
    as(p = {}) { const f = (p.io_format ?? p.$0)?.$xcoFormat || 'ext'; const [y, m, d] = this.$ymd; return { $ret: { value: f === 'ext' ? `${pad(y, 4)}-${pad(m)}-${pad(d)}` : `${pad(y, 4)}${pad(m)}${pad(d)}` } }; }
    shift(sign, p) {
      let [y, m, d] = this.$ymd;
      const calc = (p.io_calculation ?? CALC.preserving).$calc;
      const months = sign * (rt.n(p.iv_year ?? 0) * 12 + rt.n(p.iv_month ?? 0));
      if (months) {
        const t = y * 12 + (m - 1) + months; y = Math.floor(t / 12); m = t % 12 + 1;
        if (d > lastDay(y, m)) { if (calc === 'ultimo') d = lastDay(y, m); else throw rt.new('cx_xco_runtime_exception', { text: `The date ${pad(y, 4)}-${pad(m)}-${pad(d)} does not exist` }); }
      }
      const dt = new Date(Date.UTC(2000, m - 1, d)); dt.setUTCFullYear(y); dt.setUTCDate(dt.getUTCDate() + sign * rt.n(p.iv_day ?? 0));
      return { $ret: XDate.of(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate()) };
    }
    add(p = {}) { return this.shift(1, p); }
    subtract(p = {}) { return this.shift(-1, p); }
    to_string() { return this.as({}); }
    interval_to(p = {}) { const o = p.io_date ?? p.$0; const [a, b] = this.as({}).$ret.value <= o.as({}).$ret.value ? [this, o] : [o, this]; return { $ret: { lower_bound: a, upper_bound: b } }; }
  });
  const XTime = def('cl_xco_cp_time', class extends AbapObject {
    static of(h, mi, s) { const o = new XTime(); Object.assign(o, { hour: pad(h), minute: pad(mi), second: pad(s) }); return o; }
    as(p = {}) { const f = (p.io_format ?? p.$0)?.$xcoFormat || 'ext'; return { $ret: { value: f === 'ext' ? `${this.hour}:${this.minute}:${this.second}` : `${this.hour}${this.minute}${this.second}` } }; }
    interval_to(p = {}) { const o = p.io_time ?? p.$0; const sec = t => Number(t.hour) * 3600 + Number(t.minute) * 60 + Number(t.second); const [a, b] = sec(this) <= sec(o) ? [this, o] : [o, this]; return { $ret: { lower_bound: a, upper_bound: b } }; }
    add(p = {}) { return this.shiftT(1, p); }
    subtract(p = {}) { return this.shiftT(-1, p); }
    shiftT(sign, p) { let s = Number(this.hour) * 3600 + Number(this.minute) * 60 + Number(this.second) + sign * (rt.n(p.iv_hour ?? 0) * 3600 + rt.n(p.iv_minute ?? 0) * 60 + rt.n(p.iv_second ?? 0)); s = ((s % 86400) + 86400) % 86400; return { $ret: XTime.of(Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60) }; }
  });
  const XMoment = def('cl_xco_cp_moment', class extends AbapObject {
    static of(ms) { const o = new XMoment(); const d = new Date(ms); o.$ms = ms; Object.assign(o, { year: pad(d.getUTCFullYear(), 4), month: pad(d.getUTCMonth() + 1), day: pad(d.getUTCDate()), hour: pad(d.getUTCHours()), minute: pad(d.getUTCMinutes()), second: pad(d.getUTCSeconds()) }); return o; }
    as(p = {}) { const f = (p.io_format ?? p.$0)?.$xcoFormat || 'ext'; const v = f === 'ext' ? `${this.year}-${this.month}-${this.day}T${this.hour}:${this.minute}:${this.second}` : `${this.year}${this.month}${this.day}${f === 'abap' ? '' : 'T'}${this.hour}${this.minute}${this.second}`; return { $ret: { value: v } }; }
    get_date() { return { $ret: XDate.of(Number(this.year), Number(this.month), Number(this.day)) }; }
    get_time() { return { $ret: XTime.of(Number(this.hour), Number(this.minute), Number(this.second)) }; }
    get_unix_timestamp() { return { $ret: { value: Math.floor(this.$ms / 1000) } }; }
    interval_to(p = {}) { const o = p.io_moment ?? p.$0; const [a, b] = this.$ms <= o.$ms ? [this, o] : [o, this]; return { $ret: { lower_bound: a, upper_bound: b } }; }
    add(p = {}) { return { $ret: XMoment.of(this.$ms + (rt.n(p.iv_day ?? 0) * 86400 + rt.n(p.iv_hour ?? 0) * 3600 + rt.n(p.iv_minute ?? 0) * 60 + rt.n(p.iv_second ?? 0)) * 1000) }; }
    subtract(p = {}) { return { $ret: XMoment.of(this.$ms - (rt.n(p.iv_day ?? 0) * 86400 + rt.n(p.iv_hour ?? 0) * 3600 + rt.n(p.iv_minute ?? 0) * 60 + rt.n(p.iv_second ?? 0)) * 1000) }; }
  });
  const time = def('xco_cp_time', class extends AbapObject {
    static date(p = {}) { return { $ret: XDate.of(rt.n(p.iv_year), rt.n(p.iv_month), rt.n(p.iv_day)) }; }
    static time(p = {}) { return { $ret: XTime.of(rt.n(p.iv_hour ?? 0), rt.n(p.iv_minute ?? 0), rt.n(p.iv_second ?? 0)) }; }
    static moment(p = {}) { return { $ret: XMoment.of(Date.UTC(rt.n(p.iv_year), rt.n(p.iv_month) - 1, rt.n(p.iv_day), rt.n(p.iv_hour ?? 0), rt.n(p.iv_minute ?? 0), rt.n(p.iv_second ?? 0))) }; }
  });
  Object.assign(time, { format: FORMATS, time_zone: ZONES, date_calculation: CALC });
  const now = () => Date.now();
  const XSy = class extends AbapObject {
    date() { const d = new Date(now()); return { $ret: XDate.of(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()) }; }
    time() { const d = new Date(now()); return { $ret: XTime.of(d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()) }; }
    moment() { return { $ret: XMoment.of(now()) }; }
    user() { return { $ret: { name: rt.sy.uname || 'DEVELOPER' } }; }
    unix_timestamp() { return { $ret: { value: Math.floor(now() / 1000) } }; }
  };
  const XStr = def('cl_xco_cp_string', class extends AbapObject {
    static of(v) { const o = new XStr(); o.value = v; return o; }
    to_upper_case() { return { $ret: XStr.of(this.value.toUpperCase()) }; }
    to_lower_case() { return { $ret: XStr.of(this.value.toLowerCase()) }; }
    reverse() { return { $ret: XStr.of([...this.value].reverse().join('')) }; }
    append(p = {}) { return { $ret: XStr.of(this.value + rt.s(p.iv_value ?? p.$0)) }; }
    prepend(p = {}) { return { $ret: XStr.of(rt.s(p.iv_value ?? p.$0) + this.value) }; }
    split(p = {}) { const parts = this.value.split(rt.s(p.iv_delimiter ?? p.$0)); return { $ret: { value: parts, join: (q = {}) => ({ $ret: XStr.of(parts.join(rt.s(q.iv_delimiter ?? q.$0 ?? ''))) }) } }; }
    starts_with(p = {}) { return { $ret: this.value.startsWith(rt.s(p.iv_value ?? p.$0)) ? 'X' : '' }; }
    ends_with(p = {}) { return { $ret: this.value.endsWith(rt.s(p.iv_value ?? p.$0)) ? 'X' : '' }; }
    from(p = {}) { return { $ret: XStr.of(this.value.slice(rt.n(p.iv_position ?? p.$0) - 1)) }; }
    to(p = {}) { return { $ret: XStr.of(this.value.slice(0, rt.n(p.iv_position ?? p.$0))) }; }
    as_xstring(p = {}) { return { $ret: { value: Buffer.from(this.value, 'utf8').toString('hex').toUpperCase() } }; }
    get_length() { return { $ret: this.value.length }; }
  });
  // the call stack: rt.call records class and method of each call (lines "CLASS METHOD", innermost first)
  const XStack = class extends AbapObject {
    full() { const lines = [...rt.callStack].reverse(); const o = new XStack(); o.$lines = lines; o.from = { position: (p = {}) => { const c = new XStack(); c.$lines = o.$lines.slice(rt.n(p.iv_position ?? p.$0) - 1); c.to = { position: (q = {}) => { const e = new XStack(); e.$lines = c.$lines.slice(0, rt.n(q.iv_position ?? q.$0) - rt.n(p.iv_position ?? p.$0) + 1); return { $ret: e }; } }; return { $ret: c }; } }; o.to = { position: (q = {}) => { const e = new XStack(); e.$lines = o.$lines.slice(0, rt.n(q.iv_position ?? q.$0)); return { $ret: e }; } }; return { $ret: o }; }
    as_text() { const lines = this.$lines; return { $ret: { get_lines: () => ({ $ret: { value: lines } }) } }; }
  };
  const callStackApi = new XStack();
  callStackApi.full = XStack.prototype.full;
  const cp = def('xco_cp', class extends AbapObject {
    static string(p = {}) { return { $ret: XStr.of(rt.s(p.iv_value ?? p.$0)) }; }
    static xstring(p = {}) { return { $ret: { value: rt.s(p.iv_value ?? p.$0) } }; }
  });
  Object.assign(cp, { sy: new XSy(), current: { call_stack: callStackApi } });
  const cst = def('xco_cp_call_stack', class extends AbapObject {});
  Object.assign(cst, { format: { adt: () => ({ $ret: {} }) } });
  def('xco_cp_character', class extends AbapObject {});
  Object.assign(rt.cls('xco_cp_character'), { code_page: { utf_8: { value: 'UTF-8' } } });
  // released ABAP Cloud APIs: hashing, encodings, number ranges, application logs, HTTP client, e-mail
  installCloudApis(rt, { def, iface, AbapObject, cxStatic, cxDyn });
  installBackground(rt, { def, iface, AbapObject, cxStatic });
  installFormApis(rt, { def, AbapObject, cxStatic });
}
// methods running now, innermost last (one runtime per process at a time)
const CALL_STACK = [];
function tsToDate(ts) {
  const s = String(ts).padEnd(14, '0');
  return new Date(Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8), +s.slice(8, 10), +s.slice(10, 12), +s.slice(12, 14)));
}
function dateToTs(d) {
  const p = (n, l = 2) => String(n).padStart(l, '0');
  return Number(`${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`);
}

// ---- time zones (CONVERT): SAP time zone names mapped to IANA zones
const SAP_TZ = { UTC: 'UTC', GMT: 'UTC', CET: 'Europe/Berlin', EST: 'America/New_York', CST: 'America/Chicago', MST: 'America/Denver', PST: 'America/Los_Angeles', PST8: 'America/Los_Angeles',
  INDIA: 'Asia/Kolkata', JAPAN: 'Asia/Tokyo', CHINA: 'Asia/Shanghai', GMTUK: 'Europe/London', BRAZIL: 'America/Sao_Paulo', AUSNSW: 'Australia/Sydney', UAE: 'Asia/Dubai', SINGAP: 'Asia/Singapore', RUS03: 'Europe/Moscow', EET: 'Europe/Helsinki', WET: 'Europe/Lisbon' };
function ianaOf(tz) { const t = String(tz ?? 'UTC').trim(); return SAP_TZ[t.toUpperCase()] || t || 'UTC'; }
function zoned(d, tz) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: ianaOf(tz), hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(d).map(p => [p.type, p.value]));
  const jan = zoneOffset(Date.UTC(d.getUTCFullYear(), 0, 1), tz), jul = zoneOffset(Date.UTC(d.getUTCFullYear(), 6, 1), tz);
  return { ...parts, dst: zoneOffset(d.getTime(), tz) !== Math.min(jan, jul) && jan !== jul };
}
function zoneOffset(ms, tz) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: ianaOf(tz), hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(ms)).map(x => [x.type, x.value]));
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - Math.floor(ms / 1000) * 1000;
}
function tsDate(ts) {
  const s = String(Math.floor(Number(ts) || 0)).padEnd(14, '0');
  return new Date(Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8), +s.slice(8, 10), +s.slice(10, 12), +s.slice(12, 14)));
}
function parseUtclong(v) {
  const m = /^(\d{4})-?(\d{2})-?(\d{2})[T ]?(\d{2}):?(\d{2}):?(\d{2})/.exec(String(v ?? ''));
  return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6])) : null;
}

// ---- asXML (identity transformation) and the ABAP JSON format
const xmlEsc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function toAsXml(values, rt) {
  const node = (name, v) => {
    if (Array.isArray(v)) return `<${name}>${v.map(x => node('item', x)).join('')}</${name}>`;
    if (v && typeof v === 'object') return `<${name}>${Object.entries(v).filter(([k]) => !k.startsWith('%') && !k.startsWith('$')).map(([k, x]) => node(k.toUpperCase(), x)).join('')}</${name}>`;
    return `<${name}>${xmlEsc(rt.s(v))}</${name}>`;
  };
  return `<?xml version="1.0" encoding="utf-8"?><asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0"><asx:values>${Object.entries(values).map(([k, v]) => node(k.toUpperCase(), v)).join('')}</asx:values></asx:abap>`;
}
function fromAsXml(xml) {
  const re = /<(\/?)([\w:.-]+)[^>]*?(\/?)>|([^<]+)/g;
  const root = { children: [], text: '' };
  const stack = [root];
  let m;
  while ((m = re.exec(xml))) {
    if (m[4] !== undefined) { stack[stack.length - 1].text += m[4]; continue; }
    if (m[2].startsWith('?') || m[2].startsWith('!')) continue;
    if (m[1]) { stack.pop(); continue; }
    const n = { name: m[2], children: [], text: '' };
    stack[stack.length - 1].children.push(n);
    if (!m[3]) stack.push(n);
  }
  const un = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
  const val = n => {
    if (!n.children.length) return un(n.text);
    if (n.children.every(c => c.name === 'item')) return n.children.map(val);
    return Object.fromEntries(n.children.map(c => [c.name.toLowerCase(), val(c)]));
  };
  const values = root.children[0]?.children.find(c => /values$/i.test(c.name));
  return Object.fromEntries((values?.children || []).map(c => [c.name.toLowerCase(), val(c)]));
}
function toAbapJson(values) {
  const conv = v => (Array.isArray(v) ? v.map(conv) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).filter(([k]) => !k.startsWith('%') && !k.startsWith('$')).map(([k, x]) => [k.toUpperCase(), conv(x)])) : v);
  return Object.fromEntries(Object.entries(values).map(([k, v]) => [k.toUpperCase(), conv(v)]));
}
function fromAbapJson(o) {
  const conv = v => (Array.isArray(v) ? v.map(conv) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k.toLowerCase(), conv(x)])) : v);
  return conv(o);
}

// escape( ): the formats of CL_ABAP_FORMAT (HTML, XML, URL / URI, JSON, JavaScript, string templates, regular
// expressions)
export const ESCAPE_FORMATS = { e_url: 24, e_url_full: 4, e_uri: 25, e_uri_full: 26, e_uri_1: 27, e_html_text: 11, e_html_attr: 12, e_html_attr_dq: 13,
  e_html_js: 14, e_html_js_html: 15, e_xml_text: 16, e_xml_attr: 17, e_xml_attr_dq: 18, e_json_string: 19, e_string_tpl: 20, e_regex: 21, e_xss_ml: 22, e_xss_url: 23 };
const HTML = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export function escapeAs(s, f) {
  const F = ESCAPE_FORMATS;
  switch (f) {
    case F.e_url: case F.e_url_full: case F.e_uri: case F.e_uri_full: case F.e_uri_1: case F.e_xss_url: return encodeURIComponent(s);
    case F.e_html_text: case F.e_xml_text: return s.replace(/[&<>]/g, c => HTML[c]);
    case F.e_html_attr_dq: case F.e_xml_attr_dq: return s.replace(/[&<"]/g, c => HTML[c]);
    case F.e_html_js: case F.e_json_string: return s.replace(/[\\"'\n\r\t]/g, c => ({ '\\': '\\\\', '"': '\\"', "'": "\\'", '\n': '\\n', '\r': '\\r', '\t': '\\t' })[c]);
    case F.e_html_js_html: return escapeAs(escapeAs(s, F.e_html_js), F.e_html_text);
    case F.e_string_tpl: return s.replace(/[\\|{}]/g, c => `\\${c}`);
    case F.e_regex: return s.replace(/[.*+?^${}()|[\]\\]/g, c => `\\${c}`);
    default: return s.replace(/[&<>"']/g, c => HTML[c]);   // e_html_attr, e_xml_attr, e_xss_ml
  }
}
