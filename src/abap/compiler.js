// ABAP -> JavaScript compiler.
//
// Every ABAP class becomes a JS class created by a factory registered with the runtime ($rt).
// Generated code is synchronous (the database driver is synchronous), so ABAP control flow maps
// 1:1 onto JS control flow. Values follow ABAP semantics through $rt helpers:
//   - structures are plain objects with lower-case component names, internal tables are arrays
//   - assignment of structures/tables copies ($rt.clone), field symbols reference rows directly
//   - comparisons/arithmetic go through $rt.eq/$rt.n/... to get ABAP conversion rules
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tokenize, splitStatements, AbapSyntaxError } from './lexer.js';
import { DDIC_TABLE_TYPES } from './ddic-types.js';

const RESERVED = new Set(('break case catch class const continue debugger default delete do else enum export extends false finally for function if import in instanceof new null return super switch this throw true try typeof var void while with yield let static implements interface package private protected public await arguments eval undefined NaN Infinity of').split(' '));

export function jsVar(name) {
  let n = name.toLowerCase();
  const fs = /^<(.+)>$/.exec(n);
  if (fs) n = 'fs_' + fs[1];
  n = n.replace(/[^a-z0-9_$]/g, '_');
  if (/^[0-9]/.test(n)) n = '_' + n;
  if (RESERVED.has(n)) n += '_';
  return n;
}
export function prop(name) {
  const n = name.toLowerCase();
  return /^[a-z_$][a-z0-9_$]*$/.test(n) ? '.' + n : `[${JSON.stringify(n)}]`;
}
const optProp = name => {
  const n = name.toLowerCase();
  return /^[a-z_$][a-z0-9_$]*$/.test(n) ? '?.' + n : `?.[${JSON.stringify(n)}]`;
};
export function methodKey(name) {
  const n = name.toLowerCase();
  return n === 'constructor' ? '$constructor' : n;
}
const Q = s => JSON.stringify(s);

export function splitPath(v) {
  // "a-b->c=>d~e" -> [{op:null,name:'a'},{op:'-',name:'b'},{op:'->',name:'c'},...]
  const segs = [];
  let cur = '', op = null, i = 0;
  if (v.startsWith('<')) { const j = v.indexOf('>'); cur = v.slice(0, j + 1); i = j + 1; }
  if (v.startsWith('/')) { const m = /^\/[^/]+\/[A-Za-z0-9_%$]*/.exec(v); cur = m[0]; i = m[0].length; }
  for (; i < v.length; i++) {
    const c = v[i];
    if (c === '-' && v[i + 1] === '>') { segs.push({ op, name: cur }); op = '->'; cur = ''; i++; continue; }
    if (c === '=' && v[i + 1] === '>') { segs.push({ op, name: cur }); op = '=>'; cur = ''; i++; continue; }
    if (c === '-') { segs.push({ op, name: cur }); op = '-'; cur = ''; continue; }
    if (c === '/' && cur === '' && /^\/[^/]+\//.test(v.slice(i))) { const m = /^\/[^/]+\/[A-Za-z0-9_%$]*/.exec(v.slice(i)); cur = m[0]; i += m[0].length - 1; continue; }
    cur += c;
  }
  segs.push({ op, name: cur });
  return segs;
}

const NUMERIC_TYPES = new Set(['i', 'int1', 'int2', 'int4', 'int8', 'b', 's', 'p', 'f', 'decfloat16', 'decfloat34', 'abap.int4', 'abap.int8', 'abap.dec', 'abap.curr', 'abap.quan', 'abap.fltp', 'abap.int1', 'abap.int2']);
const CHAR_TYPES = new Set(['c', 'n', 'string', 'x', 'xstring', 'd', 't', 'abap_bool', 'abap_boolean', 'char1', 'sysuuid_x16', 'sysuuid_c32', 'sysuuid_c36', 'timestampl', 'timestamp', 'utclong', 'syuname', 'sydatum', 'syuzeit', 'csequence', 'clike', 'simple', 'any', 'data', 'numc']);
const BUILTIN_FUNCS = new Set(['lines', 'strlen', 'numofchar', 'condense', 'to_upper', 'to_lower', 'to_mixed', 'from_mixed', 'abs', 'ceil', 'floor', 'round', 'sign', 'trunc', 'frac', 'sqrt', 'ipow', 'nmax', 'nmin', 'cmax', 'cmin', 'xsdbool', 'boolc', 'concat_lines_of', 'substring', 'substring_after', 'substring_before', 'substring_from', 'substring_to', 'find', 'count', 'replace', 'shift_left', 'shift_right', 'reverse', 'repeat', 'escape', 'contains', 'contains_any_of', 'matches', 'line_exists', 'line_index', 'utclong_current', 'segment', 'insert', 'translate', 'match', 'exp', 'log', 'log10', 'sin', 'cos', 'tan', 'char_off', 'strlen', 'acos', 'asin', 'atan', 'cosh', 'sinh', 'tanh', 'rescale', 'xstrlen', 'utclong_add', 'utclong_diff']);
const AGGREGATES = new Set(['COUNT', 'MAX', 'MIN', 'SUM', 'AVG']);
// built-in functions whose result is a string (keeps trailing blanks in string templates)
const STRING_FUNCS = new Set(['repeat', 'substring', 'substring_after', 'substring_before', 'substring_from', 'substring_to', 'to_upper', 'to_lower',
  'to_mixed', 'from_mixed', 'reverse', 'replace', 'shift_left', 'shift_right', 'insert', 'escape', 'translate', 'segment', 'concat_lines_of', 'cmax', 'cmin', 'match']);
const BUILTIN_TYPES = new Set(['i', 'int8', 'string', 'xstring', 'c', 'n', 'p', 'd', 't', 'f', 'x', 'decfloat16', 'decfloat34', 'utclong', 'abap_bool', 'timestampl', 'timestamp', 'data']);

// ---------------------------------------------------------------------------------------------
// signatures of interfaces defined elsewhere: released SAP interfaces (stubs in src/check/stdlib)
// and global interfaces of the app compiled earlier
const KNOWN_INTERFACES = new Map();
let stdlibLoaded = false;
// debug builds (the debugger's worker): every statement can stop
export const DEBUG = { on: false };

function knownInterface(name) {
  if (!stdlibLoaded) {
    stdlibLoaded = true;
    const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'check', 'stdlib');
    for (const f of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
      if (!f.endsWith('.intf.abap')) continue;
      try { for (const d of compileAbap(fs.readFileSync(path.join(dir, f), 'utf8'), f).interfaces) if (!KNOWN_INTERFACES.has(d.name)) KNOWN_INTERFACES.set(d.name, d); } catch {}
    }
  }
  return KNOWN_INTERFACES.get(name);
}
// signatures of the built-in classes a class of the app can inherit from and redefine methods of (the exception
// classes: get_text / get_longtext RETURNING result)
const BUILTIN_CLASS_SRC = `CLASS cx_root DEFINITION ABSTRACT.
  PUBLIC SECTION.
    INTERFACES if_message.
    DATA textid TYPE c LENGTH 32 READ-ONLY.
    DATA previous TYPE REF TO cx_root READ-ONLY.
    DATA is_resumable TYPE abap_bool READ-ONLY.
    METHODS constructor IMPORTING textid LIKE textid OPTIONAL previous LIKE previous OPTIONAL.
    METHODS get_text RETURNING VALUE(result) TYPE string.
    METHODS get_longtext IMPORTING preserve_newlines TYPE abap_bool OPTIONAL RETURNING VALUE(result) TYPE string.
    METHODS get_source_position EXPORTING program_name TYPE string include_name TYPE string source_line TYPE i.
ENDCLASS.
CLASS cx_static_check DEFINITION INHERITING FROM cx_root ABSTRACT.
ENDCLASS.
CLASS cx_dynamic_check DEFINITION INHERITING FROM cx_root ABSTRACT.
ENDCLASS.
CLASS cx_no_check DEFINITION INHERITING FROM cx_root ABSTRACT.
ENDCLASS.`;
// the dictionary of the app (data elements, domains, tables, structures, CDS entities): name -> static type spec
// (see typeSpec); set by the model while it compiles the app's classes
let DDIC_SPEC = null;
export function setDdicTypes(fn) { DDIC_SPEC = fn || null; }
let BUILTIN_CLASSES = null;
// global classes of the app compiled so far (a class in another file inherits from them)
const KNOWN_CLASSES = new Map();
function builtinClass(name) {
  if (!name) return undefined;
  if (!BUILTIN_CLASSES) {
    BUILTIN_CLASSES = new Map();
    const stmts = splitStatements(tokenize(BUILTIN_CLASS_SRC, '$builtin'));
    for (let k = 0; k < stmts.length; k++) {
      if (!isKw(stmts[k][0], 'CLASS')) continue;
      const header = stmts[k], body = [];
      for (k++; k < stmts.length && !isKw(stmts[k][0], 'ENDCLASS'); k++) body.push(stmts[k]);
      const d = parseClassDefinition(header, body, '$builtin');
      d.builtin = true;
      BUILTIN_CLASSES.set(d.name, d);
    }
  }
  return BUILTIN_CLASSES.get(name);
}
export function registerInterfaces(src, file) {
  try { for (const d of compileAbap(src, file).interfaces) KNOWN_INTERFACES.set(d.name, d); } catch {}
}

export function compileAbap(src, file, { rename } = {}) {
  // src: source text, or [{ src, file }] for a class split over several includes
  // rename: Map of local class / interface names of this class pool -> the name they get in the runtime, so that
  // two class pools can each have a local class of the same name (lhc_item in two behavior pools)
  const parts = Array.isArray(src) ? src : [{ src, file }];
  const stmts = [];
  for (const p of parts) {
    const toks = tokenize(p.src, p.file);
    // the head of a name path (lhc_item=>x, lcl_util=>get( ), TYPE REF TO lhc_item), also inside string templates
    const scope = list => { for (const t of list) {
      if (t.t === 'tpl' && Array.isArray(t.v)) { for (const part of t.v) if (part.tokens) scope(part.tokens); continue; }
      if (t.t !== 'id') continue;
      const m = /^([^-=~\\>]+)(.*)$/s.exec(t.v);
      const to = m && rename.get(m[1].toLowerCase());
      if (to) t.v = `${to}${m[2]}`;
    } };
    for (const t of toks) t.file = p.file;
    if (rename?.size) scope(toks);
    stmts.push(...splitStatements(toks));
  }
  const out = { classes: [], interfaces: [], file };
  const defs = new Map();
  let i = 0;
  const err = (msg, st) => { throw new AbapSyntaxError(msg, st?.[0]?.file ?? file, st?.[0]?.line); };
  const until = (endKw) => {
    const body = [];
    i++;
    while (i < stmts.length && !isKw(stmts[i][0], endKw)) body.push(stmts[i++]);
    if (i >= stmts.length) err(`Missing ${endKw}`, stmts[i - 1]);
    i++;
    return body;
  };
  while (i < stmts.length) {
    const st = stmts[i];
    const w = st.map(t => (t.t === 'id' ? t.v.toUpperCase() : t.v));
    if (w[0] === 'CLASS' && (w[2] === 'DEFINITION') && (w.includes('DEFERRED') || w.includes('LOAD') || (w[3] === 'LOCAL' && w[4] === 'FRIENDS'))) { i++; continue; }
    if (w[0] === 'INTERFACE' && w.includes('DEFERRED')) { i++; continue; }
    if (w[0] === 'CLASS' && w[2] === 'DEFINITION') {
      const header = st;
      const body = until('ENDCLASS');
      defs.set(header[1].v.toLowerCase(), parseClassDefinition(header, body, file));
      continue;
    }
    if (w[0] === 'CLASS' && w[2] === 'IMPLEMENTATION') {
      const name = st[1].v.toLowerCase();
      const body = until('ENDCLASS');
      const def = defs.get(name);
      if (!def) err(`Implementation of class ${name} without definition`, st);
      def.impl = body;
      continue;
    }
    if (w[0] === 'INTERFACE') {
      const name = st[1].v.toLowerCase();
      const body = until('ENDINTERFACE');
      const def = parseClassDefinition(st, body, file, true);
      out.interfaces.push(def);
      defs.set(name, def);
      continue;
    }
    if (w[0] === 'REPORT' || w[0] === 'PROGRAM') err('Executable programs are not supported; use a class implementing if_oo_adt_classrun', st);
    err(`Unexpected statement '${w.slice(0, 3).join(' ')}' outside of a class`, st);
  }
  // TEST-INJECTION name ... END-TEST-INJECTION in test classes replace TEST-SEAM name in production code
  INJECTIONS = new Map();
  for (const def of defs.values()) {
    const body = def.impl || [];
    for (let k = 0; k < body.length; k++) {
      if (!isKw(body[k][0], 'TEST-INJECTION')) continue;
      const name = body[k][1].v.toLowerCase(), stmts = [];
      for (k++; k < body.length && !isKw(body[k][0], 'END-TEST-INJECTION'); k++) stmts.push(body[k]);
      INJECTIONS.set(name, stmts);
    }
  }
  try {
    for (const def of defs.values()) {
      if (def.isInterface) { def.js = genInterface(def); continue; }
      // the source name lets stack traces of the generated code point back at the class (runtime errors, debugger)
      def.js = `${genClass(def, defs, file)}\n//# sourceURL=abap:${def.name}`;
      out.classes.push(def);
      if (def.isPublic) KNOWN_CLASSES.set(def.name, def);
    }
  } finally { INJECTIONS = new Map(); }
  return out;
}
let INJECTIONS = new Map();

// a type spec in the context of another class or interface (its own TYPES resolve there first)
function specIn(mc, def, tt, struct = null, depth = 0) {
  if (!def || def === mc.cls.def) return struct ? mc.structSpec(struct, depth) : mc.typeSpec(tt, depth);
  const ctx = Object.create(Object.getPrototypeOf(mc));
  ctx.localTypes = null;
  ctx.cls = { def, defs: mc.cls.defs, lookupType: n => def.types.get(n) || mc.cls.lookupType(n) };
  return struct ? ctx.structSpec(struct, depth) : ctx.typeSpec(tt, depth);
}

function isKw(t, ...ks) { return !!t && t.t === 'id' && ks.includes(t.v.toUpperCase()); }

// ------------------------------------------------- class definitions --------------------------
function parseClassDefinition(header, body, file, isInterface = false) {
  const hw = header.map(t => (t.t === 'id' ? t.v.toUpperCase() : t.v));
  const def = {
    name: header[1].v.toLowerCase(), isInterface, file, line: header[0].line,
    superName: null, forBehaviorOf: null, interfaces: [], attrs: [], types: new Map(), methods: new Map(), aliases: new Map(),
    isPublic: hw.includes('PUBLIC'),
  };
  const inh = hw.indexOf('INHERITING');
  if (inh > 0) def.superName = header[inh + 2].v.toLowerCase();
  const fb = hw.indexOf('BEHAVIOR');
  if (fb > 0 && hw[fb - 1] === 'FOR') def.forBehaviorOf = header[fb + 2].v.toLowerCase();
  const ft = hw.indexOf('TESTING');
  if (ft > 0 && hw[ft - 1] === 'FOR') def.forTesting = true;
  const fe = hw.indexOf('EVENTS');
  if (fe > 0 && hw[fe - 1] === 'FOR' && hw[fe + 1] === 'OF') def.forEventsOf = header[fe + 2].v.toLowerCase();
  const decls = collectDeclarations(body, file, true);
  for (const d of decls) {
    if (d.kind === 'interfaces') def.interfaces.push(d.name);
    else if (d.kind === 'aliases') def.aliases.set(d.name, d.target);
    else if (d.kind === 'type') def.types.set(d.name, d);
    else if (d.kind === 'data' || d.kind === 'constant') def.attrs.push(d);
    else if (d.kind === 'method') def.methods.set(d.name, d);
  }
  return def;
}

// Parses DATA / CLASS-DATA / CONSTANTS / TYPES / METHODS / ... statements (including BEGIN OF ... END OF)
function collectDeclarations(stmts, file, inClassDef) {
  const out = [];
  for (let i = 0; i < stmts.length; i++) {
    const st = stmts[i];
    const w0 = st[0]?.t === 'id' ? st[0].v.toUpperCase() : '';
    if (/^(PUBLIC|PROTECTED|PRIVATE)$/.test(w0) && isKw(st[1], 'SECTION')) continue;
    if (w0 === 'INTERFACES') { out.push({ kind: 'interfaces', name: st[1].v.toLowerCase() }); continue; }
    if (w0 === 'ALIASES') { out.push({ kind: 'aliases', name: st[1].v.toLowerCase(), target: st[3].v.toLowerCase() }); continue; }
    if (w0 === 'METHODS' || w0 === 'CLASS-METHODS') { out.push(parseMethodSignature(st, w0 === 'CLASS-METHODS', file)); continue; }
    if (w0 === 'EVENTS' || w0 === 'CLASS-EVENTS') continue;
    if (['DATA', 'CLASS-DATA', 'CONSTANTS', 'TYPES', 'STATICS'].includes(w0)) {
      if (w0 === 'TYPES' && isKw(st[1], 'BEGIN') && isKw(st[2], 'OF') && isKw(st[3], 'ENUM')) {
        const [type, consts, next] = parseEnum(stmts, i, file);
        i = next;
        out.push(type, ...consts);
        continue;
      }
      if (isKw(st[1], 'BEGIN') && isKw(st[2], 'OF')) {
        const [decl, next] = parseStruct(stmts, i, w0, file);
        i = next;
        out.push(decl);
        continue;
      }
      out.push(parseSimpleDecl(st, w0, file));
      continue;
    }
    if (inClassDef) throw new AbapSyntaxError(`Unexpected statement in class definition: ${st.map(t => t.v).join(' ')}`, file, st[0]?.line);
  }
  return out;
}

function declKind(w0) {
  return { DATA: 'data', 'CLASS-DATA': 'data', STATICS: 'data', CONSTANTS: 'constant', TYPES: 'type' }[w0];
}

function parseSimpleDecl(st, w0, file) {
  const name = st[1].v.toLowerCase();
  let k = 2;
  if (st[k]?.t === 'p' && st[k].v === '(' && !st[k].ws) { while (st[k] && st[k].v !== ')') k++; k++; } // old style name(10)
  const rest = st.slice(k).filter(t => !(t.t === 'id' && /^READ-ONLY$/i.test(t.v)));
  let typeToks = [], valueToks = null, like = false;
  const vi = rest.findIndex(t => isKw(t, 'VALUE'));
  const typePart = vi >= 0 ? rest.slice(0, vi) : rest;
  if (vi >= 0) valueToks = rest.slice(vi + 1);
  if (isKw(typePart[0], 'TYPE')) typeToks = typePart.slice(1);
  else if (isKw(typePart[0], 'LIKE')) { typeToks = typePart.slice(1); like = true; }
  return { kind: declKind(w0), static: w0 === 'CLASS-DATA' || w0 === 'CONSTANTS' || w0 === 'STATICS', name, typeToks, like, valueToks, line: st[0].line };
}

// TYPES: BEGIN OF ENUM t [STRUCTURE s] [BASE TYPE b], v1 [VALUE ...], v2, ... END OF ENUM t [STRUCTURE s].
// The type, and its values as constants (or one constant structure s). A value is held as its name, which is also
// what CONV string( ) gives in ABAP; the initial value is the one with VALUE IS INITIAL, else the first.
function parseEnum(stmts, i, file) {
  const head = stmts[i], hw = head.map(t => String(t.v).toUpperCase());
  const name = head[4].v.toLowerCase();
  const si = hw.indexOf('STRUCTURE');
  const struct = si > 0 ? head[si + 1].v.toLowerCase() : null;
  const values = [];
  let initial = null;
  for (i++; i < stmts.length; i++) {
    const st = stmts[i];
    if (isKw(st[1], 'END') && isKw(st[2], 'OF')) break;
    const v = st[1].v.toLowerCase();
    values.push(v);
    if (st.some(t => isKw(t, 'INITIAL'))) initial = v;
  }
  if (i >= stmts.length) throw new AbapSyntaxError(`Missing END OF ENUM ${name}`, file, head[0].line);
  initial ??= values[0];
  const type = { kind: 'type', static: true, name, typeToks: [{ t: 'id', v: 'string' }], like: false, valueToks: null, enum: { values, initial }, line: head[0].line };
  const lit = v => [{ t: 'str', v: v.toUpperCase() }];
  const consts = struct
    ? [{ kind: 'constant', static: true, name: struct, struct: values.map(v => ({ kind: 'constant', name: v, typeToks: [{ t: 'id', v: name }], valueToks: lit(v) })), line: head[0].line }]
    : values.map(v => ({ kind: 'constant', static: true, name: v, typeToks: [{ t: 'id', v: name }], like: false, valueToks: lit(v), line: head[0].line }));
  return [type, consts, i];
}

function parseStruct(stmts, i, w0, file) {
  const name = stmts[i][3].v.toLowerCase();
  const comps = [];
  i++;
  while (i < stmts.length) {
    const st = stmts[i];
    if (isKw(st[1], 'END') && isKw(st[2], 'OF')) break;
    if (isKw(st[0], 'INCLUDE')) { comps.push({ include: st.slice(2) }); i++; continue; }
    if (isKw(st[1], 'BEGIN') && isKw(st[2], 'OF')) {
      const [d, next] = parseStruct(stmts, i, w0, file);
      comps.push(d); i = next + 1; continue;
    }
    comps.push(parseSimpleDecl(st, w0, file));
    i++;
  }
  if (i >= stmts.length) throw new AbapSyntaxError(`Missing END OF ${name}`, file, stmts[stmts.length - 1][0].line);
  return [{ kind: declKind(w0), static: w0 !== 'DATA', name, struct: comps, line: stmts[i][0].line }, i];
}

// METHODS name [FOR ...rap...] [IMPORTING ...] [EXPORTING ...] [CHANGING ...] [RETURNING VALUE(r) TYPE t] [RAISING ...]
function parseMethodSignature(st, isStatic, file) {
  const m = { kind: 'method', name: st[1].v.toLowerCase(), static: isStatic, importing: [], exporting: [], changing: [], returning: null, line: st[0].line };
  const w = st.map(t => (t.t === 'id' ? t.v.toUpperCase() : t.v));
  if (w.includes('REDEFINITION')) m.redefinition = true;
  if (w.includes('ABSTRACT')) m.abstract = true;
  // METHODS on_x FOR ENTITY EVENT instances FOR Alias~Event  (RAP business event handler)
  if (w[2] === 'FOR' && w[3] === 'ENTITY' && w[4] === 'EVENT') {
    const [ent, ev] = st[7].v.toLowerCase().split('~');
    m.rap = { kind: 'event', importing: st[5].v.toLowerCase(), entity: ent, target: ev, sub: [] };
    return m;
  }
  if (w[2] === 'FOR' && w[3] === 'TESTING') m.forTesting = true;
  if (w[2] === 'FOR' && !['TESTING', 'EVENT', 'TABLE'].includes(w[3])) {
    m.rap = parseRapSignature(st, w);
    return m;
  }
  let section = null;
  for (let k = 2; k < st.length; k++) {
    const u = w[k];
    if (['IMPORTING', 'EXPORTING', 'CHANGING', 'RETURNING', 'RAISING', 'EXCEPTIONS'].includes(u)) { section = u; continue; }
    if (u === 'FINAL' || u === 'DEFAULT' && false) continue;
    if (section === 'RAISING' || section === 'EXCEPTIONS' || !section) continue;
    // param: name | VALUE(name) | REFERENCE(name)
    let pname;
    if ((u === 'VALUE' || u === 'REFERENCE') && st[k + 1]?.v === '(') { pname = st[k + 2].v.toLowerCase(); k += 3; }
    else pname = st[k].v.toLowerCase();
    const p = { name: pname, typeToks: [], optional: false, def: null };
    k++;
    if (isKw(st[k], 'TYPE') || isKw(st[k], 'LIKE')) {
      p.like = isKw(st[k], 'LIKE');
      k++;
      while (k < st.length && !isParamBoundary(st, k, w)) p.typeToks.push(st[k++]);
    }
    while (k < st.length && (w[k] === 'OPTIONAL' || w[k] === 'DEFAULT')) {
      if (w[k] === 'OPTIONAL') { p.optional = true; k++; }
      else { p.optional = true; p.def = [st[k + 1]]; k += 2; }
    }
    k--;
    if (section === 'IMPORTING') m.importing.push(p);
    else if (section === 'EXPORTING') m.exporting.push(p);
    else if (section === 'CHANGING') m.changing.push(p);
    else if (section === 'RETURNING') m.returning = p;
  }
  return m;
}
function isParamBoundary(st, k, w) {
  const u = w[k];
  if (['IMPORTING', 'EXPORTING', 'CHANGING', 'RETURNING', 'RAISING', 'EXCEPTIONS', 'OPTIONAL', 'DEFAULT'].includes(u)) return true;
  // next parameter name: identifier followed by TYPE/LIKE, or VALUE(
  if ((u === 'VALUE' || u === 'REFERENCE') && st[k + 1]?.v === '(' && !st[k + 1].ws) return true;
  if (st[k].t === 'id' && (isKw(st[k + 1], 'TYPE') || isKw(st[k + 1], 'LIKE'))) {
    // "TYPE REF TO x" -> REF followed by TO, not a param; "TYPE x" has x followed by next param
    // (a parameter may be called "table": in a type, TABLE is followed by OF, never by TYPE)
    return !['TYPE', 'REF', 'OF', 'STANDARD', 'SORTED', 'HASHED', 'TO', 'LINE', 'RANGE', 'LENGTH', 'DECIMALS'].includes(u) || false;
  }
  return false;
}

function parseRapSignature(st, w) {
  // FOR DETERMINE ON MODIFY IMPORTING keys FOR Travel~setStatus
  // FOR VALIDATE ON SAVE IMPORTING keys FOR Travel~validate
  // FOR MODIFY IMPORTING keys FOR ACTION Travel~accept RESULT result
  // FOR INSTANCE AUTHORIZATION IMPORTING keys REQUEST requested_authorizations FOR Travel RESULT result
  // FOR GLOBAL AUTHORIZATION IMPORTING REQUEST requested_authorizations FOR Travel RESULT result
  // FOR INSTANCE FEATURES IMPORTING keys REQUEST requested_features FOR Travel RESULT result
  // FOR NUMBERING IMPORTING entities FOR CREATE Travel
  // FOR READ IMPORTING keys FOR READ Travel RESULT result
  const r = { kind: null, entity: null, target: null, importing: null, request: null, result: null, sub: [] };
  const imp = w.indexOf('IMPORTING');
  const head = w.slice(3, imp < 0 ? undefined : imp).join(' ');
  if (head === 'DETERMINE ON MODIFY') r.kind = 'determination_modify';
  else if (head === 'DETERMINE ON SAVE') r.kind = 'determination_save';
  else if (head === 'VALIDATE ON SAVE') r.kind = 'validation';
  else if (head === 'MODIFY') r.kind = 'modify';
  else if (head === 'INSTANCE AUTHORIZATION') r.kind = 'instance_authorization';
  else if (head === 'GLOBAL AUTHORIZATION') r.kind = 'global_authorization';
  else if (head === 'INSTANCE FEATURES') r.kind = 'instance_features';
  else if (head === 'GLOBAL FEATURES') r.kind = 'global_features';
  else if (head === 'NUMBERING') r.kind = 'numbering';
  else if (head === 'READ') r.kind = 'read';
  else if (head === 'LOCK') r.kind = 'lock';
  else if (head === 'PRECHECK') r.kind = 'precheck';
  else if (head === 'DETERMINE ACTION') r.kind = 'determine_action';
  else r.kind = 'unknown:' + head;
  let k = imp + 1;
  if (imp < 0) return r;
  if (w[k] !== 'REQUEST') r.importing = st[k++].v.toLowerCase();
  if (w[k] === 'REQUEST') { r.request = st[k + 1].v.toLowerCase(); k += 2; }
  if (w[k] === 'FOR') {
    k++;
    if (['ACTION', 'CREATE', 'UPDATE', 'DELETE', 'READ', 'LOCK'].includes(w[k])) { r.op = w[k].toLowerCase(); k++; }
    const spec = st[k].v.toLowerCase();
    k++;
    if (r.op === 'create' && st[k]?.v === '\\' ) k++;
    const [ent, tgt] = spec.split('~');
    r.entity = ent.split('\\')[0];
    r.target = tgt || null;
    if (spec.includes('\\')) r.assoc = spec.split('\\')[1];
  }
  const ri = w.indexOf('RESULT', k);
  if (ri >= 0) r.result = st[ri + 1].v.toLowerCase();
  const li = w.indexOf('LINK');
  if (li >= 0) r.link = st[li + 1].v.toLowerCase();
  return r;
}

// built-in ABAP types (and common DDIC data elements) with their default length; fixed: the length is part of the type
// the elementary types whose assignments convert (string keeps what it gets)
const CONVERTED = new Set(['i', 'int8', 'p', 'f', 'decfloat16', 'decfloat34', 'c', 'n', 'x', 'xstring', 'd', 't']);
const BUILTIN_SPECS = {
  i: { k: 'i' }, int1: { k: 'i' }, int2: { k: 'i' }, int4: { k: 'i' }, int8: { k: 'int8' }, b: { k: 'i' }, s: { k: 'i' },
  f: { k: 'f' }, p: { k: 'p', len: 8 }, decfloat16: { k: 'decfloat16' }, decfloat34: { k: 'decfloat34' },
  c: { k: 'c', len: 1 }, n: { k: 'n', len: 1 }, x: { k: 'x', len: 1 }, string: { k: 'string' }, xstring: { k: 'xstring' },
  d: { k: 'd' }, t: { k: 't' }, utclong: { k: 'utclong' }, numeric: { k: 'numeric' },
  abap_bool: { k: 'c', len: 1, fixed: true }, abap_boolean: { k: 'c', len: 1, fixed: true }, flag: { k: 'c', len: 1, fixed: true },
  sysuuid_x16: { k: 'x', len: 16, fixed: true }, sysuuid_c32: { k: 'c', len: 32, fixed: true }, timestamp: { k: 'p', len: 8, fixed: true },
  timestampl: { k: 'p', len: 11, fixed: true, dec: 7 },
};

// ---------------------------------------------------- initial values --------------------------
// Returns JS expression for the initial value of a declared type.
function initForDecl(d, ctx) {
  if (d.enum) return Q(d.enum.initial.toUpperCase());
  if (d.struct) {
    const parts = [];
    for (const c of d.struct) {
      if (c.include) parts.push(`...${initForType(c.include, false, ctx)}`);
      else parts.push(`${Q(c.name)}: ${c.valueToks ? ctx.constValue(c.valueToks) : initForDecl(c, ctx)}`);
    }
    return `{ ${parts.join(', ')} }`;
  }
  return initForType(d.typeToks, d.like, ctx);
}

function initForType(typeToks, like, ctx) {
  const w = typeToks.map(t => (t.t === 'id' ? t.v.toUpperCase() : t.v));
  if (!typeToks.length) return "''";
  if (like) {
    if (w[0] === 'LINE' && w[1] === 'OF') return `$rt.lineOf(${ctx.readPath(typeToks[2].v)})`;
    if (w[0] === 'TABLE' && w[1] === 'OF') return '[]';
    if (w[0] === 'REF' && w[1] === 'TO') return 'null';
    return `$rt.initialOf(${ctx.readPath(typeToks[0].v)})`;
  }
  if (w[0] === 'REF' && w[1] === 'TO') return 'null';
  if (w[0] === 'RESPONSE' && w[1] === 'FOR') return `$rt.resp(${Q(typeToks[typeToks.length - 1].v.toLowerCase())})`;
  if (w[0] === 'STRUCTURE' && w[1] === 'FOR') return '{}';
  if (w[0] === 'REQUEST' && w[1] === 'FOR') return '{}';
  if (w.includes('TABLE') || w[0] === 'RANGE') {
    // the line type: TYPE [STANDARD|SORTED|HASHED] TABLE OF <line> [WITH ...]
    const of = w.indexOf('OF');
    const line = [];
    if (w.includes('TABLE') && of >= 0) for (let k = of + 1; k < typeToks.length && !['WITH', 'INITIAL', 'REF'].includes(w[k]); k++) line.push(typeToks[k]);
    // a SORTED table keeps the components of its key
    let ki = w.indexOf('KEY'); const sort = [];
    if (w[ki + 2] === 'COMPONENTS') ki += 2;
    if (w[0] === 'SORTED' && ki > 0) for (let k = ki + 1; k < w.length && /^[A-Z_][A-Z0-9_]*$/.test(w[k]) && w[k] !== 'WITH' && w[k] !== 'COMPONENTS'; k++) sort.push(w[k].toLowerCase());
    if (line.length && !w.slice(of + 1).includes('REF')) { try { return `$rt.newTab(() => (${initForType(line, false, ctx)})${sort.length ? `, ${JSON.stringify(sort)}` : ''})`; } catch { return '[]'; } }
    return '[]';
  }
  if (w[0] === 'LINE' && w[1] === 'OF') {
    const ut = ctx.lookupType(typeToks[2].v.toLowerCase());
    if (ut && ut.typeToks) {
      const tw = ut.typeToks.map(t => (t.t === 'id' ? t.v.toUpperCase() : t.v));
      const of = tw.lastIndexOf('OF');
      if (of >= 0) return initForType(ut.typeToks.slice(of + 1, of + 2), false, ctx);
    }
    return '{}';
  }
  const name = typeToks[0].v.toLowerCase();
  if (DDIC_TABLE_TYPES.has(name)) return '[]';
  if (NUMERIC_TYPES.has(name)) return '0';
  if (CHAR_TYPES.has(name)) return "''";
  const ut = ctx.lookupType(name);
  if (ut) return initForDecl(ut, ctx);
  return `$rt.initType(${Q(name)})`;
}

// ---------------------------------------------------- code generation -------------------------
function genInterface(def) {
  const ctx = new ClassCtx(def, new Map());
  const consts = def.attrs.map(a => `C${prop(a.name)} = ${a.valueToks ? ctx.constValue(a.valueToks) : initForDecl(a, ctx)};`);
  return `$rt.defineInterface(${Q(def.name)}, (C) => {\n${consts.join('\n')}\n});`;
}

class ClassCtx {
  // methods of the class and its superclasses compiled from the same sources
  hasMethod(name) {
    let d = this.def;
    const seen = new Set();
    while (d && !seen.has(d.name)) { seen.add(d.name); if (d.methods?.has(name)) return true; d = d.superName ? this.defs.get(d.superName) : null; }
    return false;
  }
  constructor(def, defs) {
    this.def = def; this.defs = defs;
    this.instanceAttrs = new Set(); this.staticAttrs = new Set();
    // inherited attributes of classes compiled from the same file
    let d = def;
    const seen = new Set();
    while (d && !seen.has(d.name)) {
      seen.add(d.name);
      for (const a of d.attrs) (a.static ? this.staticAttrs : this.instanceAttrs).add(a.name);
      d = d.superName ? defs.get(d.superName) : null;
    }
    for (const ifn of def.interfaces) {
      const idf = defs.get(ifn) || knownInterface(ifn);
      if (idf) for (const a of idf.attrs) if (!a.static) this.instanceAttrs.add(`${ifn}~${a.name}`);
    }
    // ALIASES res FOR lif~attr: the alias is a member of the class (a property forwarding to the interface attribute)
    this.attrAliases = new Map();
    for (const [alias, target] of def.aliases) {
      const [ifn, an] = target.split('~');
      const idf = defs.get(ifn) || knownInterface(ifn);
      if (idf?.attrs.some(a => a.name === an)) { this.attrAliases.set(alias, target); this.instanceAttrs.add(alias); }
    }
  }
  lookupType(name) {
    if (this.localTypes?.has(name)) return this.localTypes.get(name);
    let d = this.def;
    while (d) {
      if (d.types.has(name)) return d.types.get(name);
      d = d.superName ? this.defs.get(d.superName) : null;
    }
    return null;
  }
  constValue(toks) {
    if (isKw(toks[0], 'IS') && isKw(toks[1], 'INITIAL')) return 'undefined';
    const e = new Expr(toks, this.mc || new MethodCtx(this, null));
    return e.value().js;
  }
  readPath(v) { return (this.mc || new MethodCtx(this, null)).readPath(v); }
}

function genClass(def, defs, file) {
  const ctx = new ClassCtx(def, defs);
  const base = def.superName || 'object';
  const lines = [];
  lines.push(`$rt.defineClass(${Q(def.name)}, ${Q(base)}, (Base) => {`);
  lines.push(`class $cls extends Base {`);
  // constructor: instance attributes
  const inst = def.attrs.filter(a => !a.static);
  lines.push(`constructor() { super();`);
  for (const a of inst) lines.push(`  this${prop(a.name)} = ${a.valueToks ? ctx.constValue(a.valueToks) : initForDecl(a, ctx)};`);
  for (const ifn of def.interfaces) {
    const idf = defs.get(ifn);
    if (idf) for (const a of idf.attrs.filter(a => !a.static)) lines.push(`  this[${Q(ifn + '~' + a.name)}] = ${initForDecl(a, ctx)};`);
  }
  lines.push(`}`);
  // methods
  const impls = new Map();
  if (def.impl) {
    let i = 0;
    const st = def.impl;
    while (i < st.length) {
      if (isKw(st[i][0], 'METHOD') && st[i].some(t => isKw(t, 'DATABASE'))) {
        const name = st[i][1].v.toLowerCase();
        const start = st[i];
        while (i < st.length && !st[i].some(t => isKw(t, 'ENDMETHOD'))) i++;
        i++;
        impls.set(name, { amdp: true, line: start[0].line });
        continue;
      }
      if (isKw(st[i][0], 'METHOD')) {
        const name = st[i][1].v.toLowerCase();
        const body = [];
        const start = st[i];
        i++;
        while (i < st.length && !isKw(st[i][0], 'ENDMETHOD')) body.push(st[i++]);
        if (i >= st.length) throw new AbapSyntaxError(`Missing ENDMETHOD for ${name}`, file, start[0].line);
        i++;
        impls.set(name, { body, line: start[0].line });
      } else throw new AbapSyntaxError(`Unexpected statement in class implementation: ${st[i].map(t => t.v).join(' ')}`, file, st[i][0].line);
    }
  }
  for (const [name, impl] of impls) {
    let sig = def.methods.get(name);
    if (!sig && def.aliases.size) {
      for (const [alias, target] of def.aliases) if (target === name) sig = def.methods.get(alias);
      // METHOD alias, where ALIASES alias FOR intf~meth
      const target = def.aliases.get(name);
      if (!sig && target?.includes('~')) { const [ifn, mname] = target.split('~'); sig = (defs.get(ifn) || knownInterface(ifn))?.methods.get(mname); }
    }
    if (!sig && name.includes('~')) {
      const [ifn, mname] = name.split('~');
      const idf = defs.get(ifn) || knownInterface(ifn);
      sig = idf?.methods.get(mname);
      if (!sig) sig = { name, importing: [], exporting: [], changing: [], returning: null, external: ifn };
    }
    if (sig?.redefinition) {
      // METHODS m REDEFINITION: the signature is the super class's (a class of the app or a built-in one: cx_root)
      const up = n => defs.get(n) || KNOWN_CLASSES.get(n) || builtinClass(n);
      let found = false;
      for (let d = up(def.superName), n = 0; d && n < 20; d = up(d.superName), n++) {
        const m = d.methods.get(name);
        if (m && !m.redefinition) { sig = { ...m, redefinition: true, static: sig.static }; found = true; break; }
      }
      // a super class of another file not compiled yet: an exception class's get_text / get_longtext are cx_root's
      const root = !found && builtinClass('cx_root').methods.get(name);
      if (root && name !== 'constructor') sig = { ...root, redefinition: true, static: sig.static };
    }
    if (!sig) {
      // redefinition of a method from a class we do not know (e.g. saver methods)
      sig = { name, importing: [], exporting: [], changing: [], returning: null, redefinition: true };
    }
    const mc = new MethodCtx(ctx, sig);
    ctx.mc = mc;
    const js = impl.amdp
      ? `throw $rt.new('cx_sy_dyn_call_illegal_method', { text: 'AMDP method ${name.toUpperCase()} (SQLScript) cannot run outside SAP HANA' });`
      : mc.compileMethod(impl.body, impl.line, file);
    ctx.mc = null;
    lines.push(`${sig.static ? 'static ' : ''}[${Q(methodKey(name))}]($p = {}) {\n${js}\n}`);
  }
  lines.push(`}`);
  for (const [alias, target] of ctx.attrAliases) lines.push(`Object.defineProperty($cls.prototype, ${Q(alias)}, { get() { return this[${Q(target)}]; }, set(v) { this[${Q(target)}] = v; }, configurable: true });`);
  // static attributes & constants
  ctx.mc = new MethodCtx(ctx, { name: '$static', importing: [], exporting: [], changing: [] });
  for (const a of def.attrs.filter(a => a.static)) {
    lines.push(`$cls${prop(a.name)} = ${a.valueToks ? ctx.constValue(a.valueToks) : initForDecl(a, ctx)};`);
  }
  const typeInits = [...def.types.values()].map(t => `${Q(t.name)}: () => (${initForDecl(t, ctx)})`);
  lines.push(`$cls.$types = { ${typeInits.join(', ')} };`);
  ctx.mc = null;
  const meta = {
    name: def.name, superName: def.superName, interfaces: def.interfaces, forBehaviorOf: def.forBehaviorOf,
    methods: Object.fromEntries([...def.methods.values()].map(m => [m.name, {
      static: m.static, rap: m.rap || null,
      importing: m.importing.map(p => p.name), exporting: m.exporting.map(p => p.name),
      changing: m.changing.map(p => p.name), returning: m.returning?.name || null,
    }])),
  };
  lines.push(`$cls.$meta = ${JSON.stringify(meta)};`);
  lines.push(`return $cls;`);
  lines.push(`}, ${Q(file)});`);
  return lines.join('\n');
}

// ---------------------------------------------------- method compilation ----------------------
const RAP_SAVER_PARAMS = ['create', 'update', 'delete', 'reported', 'failed', 'mapped'];

class MethodCtx {
  constructor(cls, sig) {
    this.cls = cls; this.sig = sig;
    this.scopes = [new Map()];   // ABAP name -> js name
    this.declared = new Set();   // js names to hoist
    this.localTypes = new Map();
    this.loopDepth = 0; this.tmp = 0; this.varTypes = new Map(); this.varSpecs = new Map();
    cls.localTypes = this.localTypes;
  }
  t() { return `$t${++this.tmp}`; }
  enterLoop() { const l = `$L${++this.tmp}`; (this.loopLabels ||= []).push(l); this.loopDepth++; return l; }
  leaveLoop() { this.loopLabels.pop(); this.loopDepth--; }
  get loopLabel() { return this.loopLabels?.[this.loopLabels.length - 1]; }
  declare(name, typeToks) {
    const ln = name.toLowerCase();
    const js = jsVar(ln);
    this.scopes[0].set(ln, js);
    this.declared.add(js);
    if (typeToks) this.varTypes.set(ln, typeToks);
    return js;
  }
  // the variables in scope as getters (the debugger reads them only when it stops)
  dynScopeGetters() {
    const seen = new Map();
    for (const sc of this.scopes) for (const [n, js] of sc) if (!n.startsWith('$') && /^[\w$<>]+$/.test(js) && !/^\$t\d/.test(js)) seen.set(n, js);
    return `{ ${[...seen].map(([n, js]) => `${Q(n)}: () => ${js}`).join(', ')} }`;
  }
  // the variables in scope by ABAP name, for names given at runtime (ASSIGN (name), EXPORT (ptab) ...)
  dynScopeJs() {
    const seen = new Map();
    for (const sc of this.scopes) for (const [n, js] of sc) if (!n.startsWith('$') && /^[\w$<>]+$/.test(js) && !/^\$t\d/.test(js)) seen.set(n, js);
    return `{ ${[...seen].map(([n, js]) => `${Q(n)}: [() => ${js}, ($v) => { ${js} = $v; }]`).join(', ')} }`;
  }
  lookup(ln) {
    for (let k = this.scopes.length - 1; k >= 0; k--) if (this.scopes[k].has(ln)) return this.scopes[k].get(ln);
    return null;
  }
  pushScope(map) { this.scopes.push(map); }
  popScope() { this.scopes.pop(); }

  compileMethod(body, line, file) {
    this.file = file;
    const sig = this.sig;
    const pro = [];
    const epi = [];
    const rap = sig.rap;
    if (rap) {
      const imp = rap.importing;
      if (imp) { this.declare(imp); pro.push(`${jsVar(imp)} = $p${prop(imp)} ?? [];`); }
      if (rap.request) { this.declare(rap.request); pro.push(`${jsVar(rap.request)} = $p${prop(rap.request)} ?? {};`); }
      if (rap.result) { this.declare(rap.result); pro.push(`${jsVar(rap.result)} = $p${prop(rap.result)} ?? [];`); epi.push(`${Q(rap.result)}: ${jsVar(rap.result)}`); }
      if (rap.link) { this.declare(rap.link); pro.push(`${jsVar(rap.link)} = [];`); epi.push(`${Q(rap.link)}: ${jsVar(rap.link)}`); }
      for (const p of ['failed', 'reported', 'mapped']) {
        this.declare(p); pro.push(`${p} = $p.${p} ?? $rt.resp(null);`); epi.push(`${p}`);
      }
    } else {
      const imps = sig.importing || [];
      imps.forEach((p, idx) => {
        const js = this.declare(p.name, p.typeToks);
        const def = p.def ? new Expr(p.def, this).value().js : (p.typeToks ? initForType(p.typeToks, p.like, this.cls) : "''");
        const pos = idx === 0 ? ` ?? $p.$0` : '';
        pro.push(`${js} = $p${prop(p.name)}${pos} ?? ${def};`);
      });
      for (const p of sig.exporting || []) {
        const js = this.declare(p.name, p.typeToks);
        pro.push(`${js} = ${p.typeToks?.length ? initForType(p.typeToks, p.like, this.cls) : "''"};`);
        epi.push(`${Q(p.name)}: ${js}`);
      }
      for (const p of sig.changing || []) {
        const js = this.declare(p.name, p.typeToks);
        pro.push(`${js} = $p${prop(p.name)} ?? ${p.typeToks?.length ? initForType(p.typeToks, p.like, this.cls) : "''"};`);
        epi.push(`${Q(p.name)}: ${js}`);
      }
      if (sig.returning) {
        const p = sig.returning;
        const js = this.declare(p.name, p.typeToks);
        pro.push(`${js} = ${p.typeToks?.length ? initForType(p.typeToks, p.like, this.cls) : "''"};`);
        epi.push(`$ret: ${js}`, `${Q(p.name)}: ${js}`);
      }
      if (sig.redefinition || sig.external) {
        // implicit parameters of framework methods (saver: create/update/delete/reported/failed/mapped; classrun: out)
        for (const p of [...RAP_SAVER_PARAMS, 'out']) {
          const js = this.declare(p);
          pro.push(`${js} = $p${prop(p)};`);
          if (['reported', 'failed', 'mapped'].includes(p)) epi.push(`${p}`);
        }
      }
    }
    const bodyJs = this.block(body);
    const hoist = this.declared.size ? `let ${[...this.declared].join(', ')};\n` : '';
    return `${hoist}${pro.join('\n')}\n$m: {\n${bodyJs}\n}\nreturn { ${epi.join(', ')} };`;
  }

  // ---- blocks -----------------------------------------------------------------------------
  block(stmts) {
    const out = [];
    let i = 0;
    while (i < stmts.length) {
      const [js, next] = this.statement(stmts, i);
      if (js) out.push(js);
      i = next;
    }
    return out.join('\n');
  }

  // collect statements until one of the end keywords at the same nesting level
  collect(stmts, i, enders) {
    const OPEN = { IF: 'ENDIF', LOOP: 'ENDLOOP', DO: 'ENDDO', WHILE: 'ENDWHILE', CASE: 'ENDCASE', TRY: 'ENDTRY', SELECT: 'ENDSELECT' };
    const body = [];
    let depth = 0;
    while (i < stmts.length) {
      const st = stmts[i];
      const w = st[0]?.t === 'id' ? st[0].v.toUpperCase() : '';
      if (depth === 0 && enders.includes(w)) return [body, i];
      if (OPEN[w] && !(w === 'SELECT' && !isLoopSelect(st)) && !(w === 'LOOP' && false)) depth++;
      if (Object.values(OPEN).includes(w)) depth--;
      body.push(st);
      i++;
    }
    this.err(`Missing ${enders.join('/')}`, stmts[i - 1]);
  }

  // the line of the statement being compiled when the error has none of its own
  err(msg, st) { const line = st?.[0]?.line ?? st?.line; throw new AbapSyntaxError(msg, st?.[0]?.file ?? this.file, line === '?' || line === undefined ? this.curLine ?? line : line); }

  statement(stmts, i) {
    let st = stmts[i];
    this.curLine = st[0]?.line;
    // IN CHARACTER MODE / IN BYTE MODE (SPLIT, CONCATENATE, FIND, REPLACE, SHIFT ...): byte fields are hex text here
    if (/^(SPLIT|CONCATENATE|FIND|REPLACE|SHIFT|CONDENSE|OVERLAY|TRANSLATE)$/i.test(st[0]?.v || '')) {
      const k = st.findIndex((t, q) => isKw(t, 'IN') && isKw(st[q + 1], 'CHARACTER', 'BYTE') && isKw(st[q + 2], 'MODE'));
      if (k > 0) { st = [...st.slice(0, k), ...st.slice(k + 3)]; stmts = [...stmts]; stmts[i] = st; }
    }
    const w = st.map(t => (t.t === 'id' ? t.v.toUpperCase() : t.v));
    const kw = w[0];
    const line = st[0].line;
    // the statement's source position (runtime errors map generated code back to it); in debug builds a stop for
    // the debugger with the variables in scope
    // (the statement's own file: local classes of a class pool live in its includes, e.g. .clas.locals_imp.abap)
    const sfile = st[0].file || this.file || '';
    const pos = `${sfile}:${line}`;
    // (declarations are not executable: the debugger does not stop there, as in SAP)
    const declOnly = /^(DATA|TYPES|CONSTANTS|FIELD-SYMBOLS|STATICS|CLASS-DATA)$/.test(kw) && !(st[1]?.v === '(' && !st[1].ws);
    const tag = DEBUG.on && !declOnly && !/^(ELSE|ELSEIF|WHEN|ENDIF|ENDLOOP|ENDDO|ENDWHILE|ENDCASE|ENDTRY|CATCH|CLEANUP|ENDMETHOD|METHOD)$/.test(kw)
      ? `/*${pos}*/ $rt.dbg?.(${Q(sfile)}, ${line}, () => (${this.dynScopeJs()}), this); `
      : `/*${pos}*/ `;
    const inlineDecl = (kw === 'DATA' || kw === 'FINAL') && st[1]?.t === 'p' && st[1].v === '(' && !st[1].ws;
    // a variable named like a statement keyword (check = ..., data = ...) is an assignment
    const isAssign = st[0]?.t === 'id' && st[1]?.t === 'p' && ['=', '+=', '-=', '*=', '/=', '&&=', '?='].includes(st[1].v) && st[1].ws !== false;
    // a method named like a statement keyword (read( ... ), delete( ... )): a call, not the statement
    const isCall = st[0]?.t === 'id' && st[1]?.t === 'p' && st[1].v === '(' && !st[1].ws && !inlineDecl;
    switch (inlineDecl || isAssign || isCall ? '' : kw) {
      case 'DATA': case 'STATICS': case 'CONSTANTS': case 'FIELD-SYMBOLS': case 'TYPES': {
        if (kw === 'TYPES' && isKw(st[1], 'BEGIN') && isKw(st[2], 'OF') && isKw(st[3], 'ENUM')) {
          const [type, consts, next] = parseEnum(stmts, i, this.file);
          this.localTypes.set(type.name, type);
          const code = consts.map(c => `${this.declare(c.name, c.struct ? null : c.typeToks)} = ${c.struct ? `{ ${c.struct.map(x => `${Q(x.name)}: ${Q(x.name.toUpperCase())}`).join(', ')} }` : Q(c.name.toUpperCase())};`);
          return [`${tag}${code.join(' ')}`, next + 1];
        }
        if (isKw(st[1], 'BEGIN') && isKw(st[2], 'OF')) {
          const [decl, next] = parseStruct(stmts, i, kw, this.file);
          if (kw === 'TYPES') { this.localTypes.set(decl.name, decl); return [null, next + 1]; }
          const js = this.declare(decl.name);
          this.varSpecs.set(decl.name.toLowerCase(), this.structSpec(decl.struct));
          return [`${tag}${js} = ${initForDecl(decl, this.cls)};`, next + 1];
        }
        if (kw === 'TYPES') { const d = parseSimpleDecl(st, kw, this.file); this.localTypes.set(d.name, d); return [null, i + 1]; }
        if (kw === 'FIELD-SYMBOLS') { const ti = w.indexOf('TYPE'); const js = this.declare(st[1].v, ti > 0 && w[ti + 1] !== 'REF' ? st.slice(ti + 1) : null); return [`${js} = undefined;`, i + 1]; }
        const d = parseSimpleDecl(st, kw, this.file);
        const js = this.declare(d.name, d.like ? null : d.typeToks);
        if (d.like && d.typeToks?.length === 1) { const ls = this.specOfName(String(d.typeToks[0].v)); if (ls) this.varSpecs.set(d.name.toLowerCase(), ls); }
        const init = d.valueToks ? new Expr(d.valueToks, this).value().js : initForDecl(d, this.cls);
        return [`${tag}${js} = ${init};`, i + 1];
      }
      case 'IF': {
        const parts = [];
        let cond = this.cond(st.slice(1), st);
        let j = i + 1;
        for (;;) {
          const [body, k] = this.collect(stmts, j, ['ELSEIF', 'ELSE', 'ENDIF']);
          parts.push({ cond, body });
          const ew = stmts[k][0].v.toUpperCase();
          if (ew === 'ENDIF') { j = k + 1; break; }
          if (ew === 'ELSE') {
            const [b2, k2] = this.collect(stmts, k + 1, ['ENDIF']);
            parts.push({ cond: null, body: b2 });
            j = k2 + 1; break;
          }
          cond = this.cond(stmts[k].slice(1), stmts[k]);
          j = k + 1;
        }
        const js = parts.map((p, n) => `${n ? ' else ' : ''}${p.cond !== null ? `if (${p.cond}) ` : ''}{\n${this.block(p.body)}\n}`).join('');
        return [tag + js, j];
      }
      case 'CASE': {
        const t = this.t();
        const subject = new Expr(st.slice(1), this).value().js;
        let j = i + 1;
        while (j < stmts.length && !isKw(stmts[j][0], 'WHEN', 'ENDCASE')) j++;
        const parts = [];
        while (!isKw(stmts[j][0], 'ENDCASE')) {
          const wst = stmts[j];
          const [body, k] = this.collect(stmts, j + 1, ['WHEN', 'ENDCASE']);
          if (isKw(wst[1], 'OTHERS')) parts.push({ cond: null, body });
          else {
            const alts = splitTopLevelWord(wst.slice(1), 'OR').map(a => `$rt.eq(${t}, ${new Expr(a, this).value().js})`);
            parts.push({ cond: alts.join(' || '), body });
          }
          j = k;
        }
        const ordered = [...parts.filter(p => p.cond), ...parts.filter(p => !p.cond)];
        const js = ordered.map((p, n) => `${n ? ' else ' : ''}${p.cond ? `if (${p.cond}) ` : ''}{\n${this.block(p.body)}\n}`).join('');
        return [`${tag}{ const ${t} = ${subject};\n${js || ''} }`, j + 1];
      }
      case 'DO': {
        const [body, k] = this.collect(stmts, i + 1, ['ENDDO']);
        const t = this.t();
        let head;
        if (w.includes('TIMES')) head = `for (let ${t} = 0, ${t}n = $rt.n(${new Expr(st.slice(1, w.lastIndexOf('TIMES')), this).value().js}); ${t} < ${t}n; ${t}++)`;
        else head = `for (let ${t} = 0; ; ${t}++)`;
        const L = this.enterLoop();
        const b = this.block(body);
        this.leaveLoop();
        // sy-index counts the passes; after the loop it is the outer loop's again
        return [`${tag}const ${t}o = $rt.sy.index; ${L}: ${head} { $rt.sy.index = ${t} + 1;\n${b}\n}\n$rt.sy.index = ${t}o;`, k + 1];
      }
      case 'WHILE': {
        const [body, k] = this.collect(stmts, i + 1, ['ENDWHILE']);
        const c = this.cond(st.slice(1), st);
        const t = this.t();
        const L = this.enterLoop();
        const b = this.block(body);
        this.leaveLoop();
        return [`${tag}const ${t}o = $rt.sy.index; let ${t} = 0; ${L}: while (${c}) { $rt.sy.index = ++${t};\n${b}\n}\n$rt.sy.index = ${t}o;`, k + 1];
      }
      case 'LOOP': return this.loopAt(stmts, i, st, w, tag);
      case 'EXIT': return [this.loopDepth ? `break ${this.loopLabel};` : 'break $m;', i + 1];
      case 'CONTINUE': return [`continue ${this.loopLabel};`, i + 1];
      case 'RETURN': return ['break $m;', i + 1];
      case 'CHECK': {
        const c = this.cond(st.slice(1), st);
        return [`if (!(${c})) ${this.loopDepth ? `continue ${this.loopLabel}` : 'break $m'};`, i + 1];
      }
      case 'TRY': return this.tryBlock(stmts, i, tag);
      case 'RAISE': return [tag + this.raise(st, w), i + 1];
      case 'CLEAR': case 'FREE': case 'REFRESH': {
        if (kw === 'FREE' && w[1] === 'MEMORY') return [`${tag}$rt.freeMemory(${w[2] === 'ID' ? new Expr(st.slice(3), this).value().js : 'null'});`, i + 1];
        const out = [];
        let rest = st.slice(1);
        const tgt = this.target(rest.slice(0, rest.length), st);
        return [tag + this.assign(tgt, `$rt.initialOf(${tgt.read})`, false), i + 1];
      }
      case 'APPEND': return [tag + this.append(st, w), i + 1];
      case 'INSERT': return [tag + this.insert(st, w), i + 1];
      case 'MODIFY': {
        if (w[1] === 'ENTITIES' || w[1] === 'ENTITY') return [tag + this.emlModify(st, w), i + 1];
        return [tag + this.modifyStmt(st, w), i + 1];
      }
      case 'READ': {
        if (w[1] === 'ENTITIES' || w[1] === 'ENTITY') return [tag + this.emlRead(st, w), i + 1];
        if (w[1] === 'TABLE') return [tag + this.readTable(st, w), i + 1];
        if (w[1] === 'DATASET') {   // READ DATASET f INTO x [LENGTH len]: the next line (text) or the content (binary)
          const ii = w.indexOf('INTO'), li = w.indexOf('LENGTH');
          const tgt = this.target(st.slice(ii + 1, li > 0 ? li : undefined), st);
          return [`${tag}{ const $r = $rt.datasetRead(${new Expr(st.slice(2, ii), this).value().js}); if ($r !== null) ${this.assign(tgt, '$r', false)} }`, i + 1];
        }
        this.err('Unsupported READ statement', st);
      }
      case 'COMMIT': return [tag + this.emlCommit(st, w), i + 1];
      case 'ROLLBACK': return [`${tag}${w[1] === 'WORK' ? '$rt.rollbackWork(); ' : ''}$rt.eml.rollback();`, i + 1];
      case 'GET': {
        if (w[1] === 'TIME' && w[2] === 'STAMP') {
          const tgt = this.target(st.slice(4), st);
          return [tag + this.assign(tgt, w[3] === 'FIELD' ? '$rt.timestampl()' : '$rt.timestampl()', false), i + 1];
        }
        if (w[1] === 'PERMISSIONS') return [`/* GET PERMISSIONS not supported */`, i + 1];
        if (w[1] === 'PARAMETER') {
          // GET PARAMETER ID pid FIELD f: SAP memory of the user (SET PARAMETER); sy-subrc 4 when not set
          const fi = w.indexOf('FIELD');
          const tgt = this.target(st.slice(fi + 1), st);
          return [`${tag}{ const $k = $rt.s(${new Expr(st.slice(3, fi), this).value().js}).toUpperCase(); if ($rt.sapMemory.has($k)) { ${this.assign(tgt, '$rt.clone($rt.sapMemory.get($k))', false)} $rt.sy.subrc = 0; } else { ${this.assign(tgt, `$rt.initialOf(${tgt.read})`, false)} $rt.sy.subrc = 4; } }`, i + 1];
        }
        if (w[1] === 'REFERENCE' && w[2] === 'OF') {
          // GET REFERENCE OF dobj INTO dref
          const ii = w.indexOf('INTO');
          const src = this.target(st.slice(3, ii), st);
          const ref = src.kind === 'deref' ? src.js : `$rt.ref(() => ${src.read}, ($v) => { ${this.assign(src, '$v', false)} })`;
          return [tag + this.assign(this.target(st.slice(ii + 1), st), ref, false), i + 1];
        }
        break;
      }
      case 'DELETE': return [tag + this.deleteStmt(st, w), i + 1];
      case 'SORT': return [tag + this.sortStmt(st, w), i + 1];
      case 'SELECT': {
        if (isLoopSelect(st)) {
          // SELECT ... INTO wa ... ENDSELECT: fetch into a temporary table, then loop
          const [body, k] = this.collect(stmts, i + 1, ['ENDSELECT']);
          const t = this.t();
          const ii = w.lastIndexOf('INTO');
          let into = st.slice(ii + 1);
          let corr = false;
          if (isKw(into[0], 'CORRESPONDING')) { corr = true; into = into.slice(3); }
          // INTO TABLE itab PACKAGE SIZE n: the loop body runs once per package of n rows
          let pkg = null;
          const pk = into.findIndex(x => isKw(x, 'PACKAGE'));
          if (pk >= 0) { pkg = new Expr(into.slice(pk + 2), this).value().js; into = into.slice(0, pk); if (isKw(into[0], 'TABLE')) into = into.slice(1); }
          // INTO (@a, @b, ...) assigns the columns in order; INTO wa the row
          const list = into[0]?.v === '(' ? splitTopLevelComma(into.slice(1, -1)).map(x => this.target(x.filter(y => y.v !== '@'), st)) : null;
          const tgt = list ? null : this.target(into.filter(x => x.v !== '@'), st);
          this.declared.add(t);
          const fetch = (this.pendingSql || new SqlBuilder(this)).select([...st.slice(0, ii), { t: 'id', v: 'INTO', ws: true, line: st[0].line }, { t: 'id', v: 'TABLE', ws: true }, { t: 'p', v: '@', ws: true }, { t: 'id', v: t, ws: false }], true);
          const L = this.enterLoop();
          const b = this.block(body);
          this.leaveLoop();
          const bind = list ? list.map((g, n) => this.assign(g, `Object.values(${t}r)[${n}]`, false)).join(' ') : this.assign(tgt, corr ? `$rt.corresponding(${t}r, ${tgt.read}, [], [], null, true)` : `${t}r`, false);
          const rows = pkg ? `Array.from({ length: Math.ceil(${t}.length / Math.max(1, $rt.n(${pkg}))) }, (_, n) => ${t}.slice(n * Math.max(1, $rt.n(${pkg})), (n + 1) * Math.max(1, $rt.n(${pkg}))))` : t;
          return [`${tag}${fetch.replace(new RegExp(`\\b${t.replace('$', '\\$')} = `), `${t} = `)}\n${L}: for (const ${t}r of ${rows}) { $rt.sy.subrc = 0; ${bind}\n${b}\n} $rt.sy.subrc = ${t}.length ? 0 : 4;`, k + 1];
        }
        return [tag + this.selectStmt(st, w), i + 1];
      }
      case 'UPDATE': return [tag + this.updateDb(st, w), i + 1];
      case 'CONCATENATE': return [tag + this.concatenate(st, w), i + 1];
      case 'CONDENSE': {
        const tgt = this.target([st[1]], st);
        return [tag + this.assign(tgt, `$rt.f.condense({val: ${tgt.read}${w.includes('NO-GAPS') ? ", del: ' '" : ''}})${w.includes('NO-GAPS') ? '.replace(/ /g, "")' : ''}`, false), i + 1];
      }
      case 'TRANSLATE': {
        const tgt = this.target([st[1]], st);
        const up = w.includes('UPPER');
        return [tag + this.assign(tgt, `$rt.s(${tgt.read}).${up ? 'toUpperCase' : 'toLowerCase'}()`, false), i + 1];
      }
      case 'REPLACE': return [tag + this.replaceStmt(st, w), i + 1];
      case 'SPLIT': return [tag + this.splitStmt(st, w), i + 1];
      case 'ASSIGN': return [tag + this.assignStmt(st, w), i + 1];
      case 'UNASSIGN': return [`${this.readPath(st[1].v)} = undefined;`, i + 1];
      case 'CREATE': {
        if (w[1] === 'DATA') {
          // data references are represented by their value: CREATE DATA dref TYPE t  ->  dref = initial value of t
          const tgt = this.target([st[2]], st);
          const ti = w.indexOf('TYPE'), li = w.indexOf('LIKE');
          let init = "''";
          if (ti > 0 && w[ti + 1] === 'HANDLE') init = `$rt.initialOfDescr(${new Expr(st.slice(ti + 2), this).value().js})`;   // CREATE DATA dref TYPE HANDLE rtts_descr
          else if (ti > 0) init = st[ti + 1].t === 'p' ? "''" : initForType(st.slice(ti + 1).filter(t => !isKw(t, 'VALUE')), false, this.cls);
          else if (li > 0) init = initForType(st.slice(li + 1), true, this.cls);
          return [tag + this.assign(tgt, `$rt.newRef(${init})`, false), i + 1];
        }
        if (w[1] !== 'OBJECT') this.err('Unsupported CREATE statement', st);
        const tgt = this.target([st[2]], st);
        let cls = null, k = 3;
        if (w[3] === 'TYPE') { cls = st[4].v.toLowerCase(); k = 5; }
        else cls = this.refTypeOf(st[2].v);
        if (!cls) this.err('Cannot determine class for CREATE OBJECT; use TYPE', st);
        let args = '{}';
        if (w[k] === 'EXPORTING') args = new Expr(st.slice(k + 1), this).namedArgs();
        return [tag + this.assign(tgt, `$rt.new(${Q(cls)}, ${args})`, false), i + 1];
      }
      case 'CALL': {
        if (w[1] === 'METHOD') return [tag + this.callStatement(st.slice(2), st, true), i + 1];
        if (w[1] === 'TRANSFORMATION') return [tag + this.callTransformation(st, w), i + 1];
        if (w[1] === 'FUNCTION') return [tag + this.callFunction(st, w), i + 1];
        if (w[1] === 'TRANSACTION') return [tag + this.callTransactionStmt(st, w), i + 1];
        this.err(`Unsupported statement CALL ${w[1]}`, st);
      }
      case 'ASSERT': return [`${tag}if (!(${this.cond(st.slice(1), st)})) throw $rt.new('cx_sy_assert', {text: 'ASSERT failed (line ${line})'});`, i + 1];
      case 'MESSAGE': {
        // MESSAGE ... RAISING exc: the message fields are set and the classic exception exc is raised
        const ri = w.lastIndexOf('RAISING');
        if (ri > 0) {
          const [head] = this.statement([...stmts.slice(0, i), st.slice(0, ri)], i);
          return [`${tag}{ ${head.replace(/\$rt\.log\('MESSAGE', [^;]*\);/, '')} throw $rt.classicException(${Q(String(st[ri + 1].v).toLowerCase())}); }`, i + 1];
        }
        // MESSAGE e005(cls) [WITH a b c d] [INTO text]: sets sy-msgid/msgno/msgty/msgv1..4
        const m = /^([a-z])(\d{3})$/i.exec(st[1]?.v || '');
        if (m && st[2]?.v === '(') {
          const cls = st[3].v;
          const ii = w.indexOf('INTO'), wi = w.indexOf('WITH');
          const args = [];
          if (wi > 0) { const ex = new Expr(st.slice(wi + 1, ii > 0 ? ii : undefined), this); while (!ex.done() && args.length < 4) args.push(ex.value().js); }
          const set = `$rt.sy.msgid = ${Q(cls.toUpperCase())}; $rt.sy.msgno = ${Q(m[2])}; $rt.sy.msgty = ${Q(m[1].toUpperCase())}; ${[0, 1, 2, 3].map(n => `$rt.sy.msgv${n + 1} = ${args[n] ? `$rt.s(${args[n]})` : "''"};`).join(' ')}`;
          const text = `$rt.msgText(${Q(cls.toLowerCase())}, ${Q(m[2])}, [${args.join(', ')}])`;
          return [`${tag}{ ${set} ${ii > 0 ? this.assign(this.target(st.slice(ii + 1), st), text, false) : `$rt.log('MESSAGE', ${text});`} }`, i + 1];
        }
        return [`${tag}$rt.log('MESSAGE', ${st.slice(1).map(t => Q(t.v)).join(', ')});`, i + 1];
      }
      case 'WRITE': { const wv = new Expr(st.slice(w[1] === '/' ? 2 : 1), this).value(); return [`${tag}$rt.write(${wv.spec?.k === 'p' && wv.spec.dec > 0 ? `$rt.pstr(${wv.js}, ${wv.spec.dec}, 1)` : wv.js});`, i + 1]; }
      case 'COMMIT_WORK': break;
      case 'WAIT': case 'BREAK-POINT': case 'LOG-POINT': return [null, i + 1];
      case 'NEW': return [tag + this.newCallStatement(st), i + 1];
      case 'EXPORT': case 'IMPORT': return [tag + this.exportImport(st, w), i + 1];
      case 'PERFORM': return [tag + this.perform(st, w), i + 1];
      case 'SUBMIT': return [tag + this.submitStmt(st, w), i + 1];
      case 'OPEN': if (w[1] === 'CURSOR') return [tag + this.openCursor(st, w), i + 1]; if (w[1] === 'DATASET') return [tag + this.dataset(st, w), i + 1]; break;
      case 'FETCH': return [tag + this.fetchCursor(st, w), i + 1];
      case 'CLOSE': if (w[1] === 'CURSOR') return [`${tag}$rt.closeCursor(${new Expr(st.slice(2).filter(t => !(t.t === 'p' && t.v === '@')), this).value().js});`, i + 1]; if (w[1] === 'DATASET') return [tag + this.dataset(st, w), i + 1]; break;
      case 'TRANSFER': return [tag + this.dataset(st, w), i + 1];
      case 'COLLECT': {
        // COLLECT wa INTO itab: the numeric components are added to the line with the same other components
        const ii = w.indexOf('INTO');
        return [`${tag}$rt.collect(${this.readPath(st[ii + 1].v)}, ${new Expr(st.slice(1, ii), this).value().js});`, i + 1];
      }
      case 'TEST-SEAM': {
        const name = st[1].v.toLowerCase();
        const [body, k] = this.collect(stmts, i + 1, ['END-TEST-SEAM']);
        const inj = INJECTIONS.get(name);
        return [inj ? `${tag}if ($rt.injected?.has(${Q(name)})) {\n${this.block(inj)}\n} else {\n${this.block(body)}\n}` : this.block(body), k + 1];
      }
      case 'TEST-INJECTION': {
        // activates the injection for the rest of the test method; its code runs in place of the seam
        const name = st[1].v.toLowerCase();
        const [, k] = this.collect(stmts, i + 1, ['END-TEST-INJECTION']);
        return [`${tag}($rt.injected ||= new Set()).add(${Q(name)});`, k + 1];
      }
      case 'END-TEST-SEAM': case 'END-TEST-INJECTION': return [null, i + 1];
      case 'MOVE-CORRESPONDING': {
        const ti = w.indexOf('TO');
        const end = st.findIndex((t, q) => q > ti && isKw(t, 'EXPANDING', 'KEEPING'));
        const src = new Expr(st.slice(1, ti), this).value().js;
        const tgt = this.target(st.slice(ti + 1, end < 0 ? undefined : end), st);
        const keep = w.includes('KEEPING');
        return [tag + this.assign(tgt, `$rt.moveCorresponding(${src}, ${tgt.read}, ${keep})`, false), i + 1];
      }
      case 'FIND': return [tag + this.findStmt(st, w), i + 1];
      case 'WITH': {
        if (st[1]?.v !== '+') break;
        const b = new SqlBuilder(this);
        const main = b.ctes(st);
        if (!isLoopSelect(main)) return [tag + b.select(main), i + 1];
        // WITH ... SELECT ... INTO wa ... ENDWITH: a loop like SELECT ... ENDSELECT
        const k = stmts.findIndex((x, q) => q > i && isKw(x[0], 'ENDWITH'));
        if (k < 0) this.err('Missing ENDWITH', st);
        const copy = [...stmts];
        copy[i] = main;
        copy[k] = [{ ...stmts[k][0], v: 'ENDSELECT' }];
        this.pendingSql = b;
        try { return this.statement(copy, i); } finally { this.pendingSql = null; }
      }
      case 'OVERLAY': {
        // OVERLAY text WITH mask [USING chars]: blanks (or chars) in text are replaced by mask characters
        const wi = w.indexOf('WITH'), ui = w.indexOf('USING');
        const tgt = this.target(st.slice(1, wi), st);
        const mask = new Expr(st.slice(wi + 1, ui < 0 ? undefined : ui), this).value().js;
        const chars = ui > 0 ? new Expr(st.slice(ui + 1), this).value().js : "' '";
        return [tag + this.assign(tgt, `[...$rt.s(${tgt.read}).padEnd($rt.s(${mask}).length)].map((c, n) => ($rt.s(${chars}).includes(c) && n < $rt.s(${mask}).length ? $rt.s(${mask})[n] : c)).join('')`, false), i + 1];
      }
      case 'SHIFT': {
        // SHIFT dobj [BY n PLACES | UP TO sub] [LEFT|RIGHT] [CIRCULAR] | SHIFT dobj LEFT|RIGHT DELETING LEADING|TRAILING mask
        const tgt = this.target([st[1]], st);
        const kw = new Set(['BY', 'UP', 'LEFT', 'RIGHT', 'CIRCULAR', 'DELETING', 'IN']);
        const opt = { dir: w.includes('RIGHT') ? 'right' : 'left', circular: w.includes('CIRCULAR') };
        const after = k => { let e = k; while (e < st.length && !kw.has(w[e])) e++; return new Expr(st.slice(k, e), this).value().js; };
        const by = w.indexOf('BY'), up = w.indexOf('UP'), del = w.indexOf('DELETING');
        const args = [`dir: ${Q(opt.dir)}`, `circular: ${opt.circular}`];
        if (by > 0) args.push(`places: ${after(by + 1)}`);
        if (up > 0) args.push(`upTo: ${after(up + 2)}`);
        if (del > 0) args.push(`deleting: ${Q(w[del + 1].toLowerCase())}`, `mask: ${after(del + 2)}`);
        return [tag + this.assign(tgt, `$rt.shift(${tgt.read}, { ${args.join(', ')} })`, false), i + 1];
      }
      case 'CONVERT': {
        // CONVERT UTCLONG ts [TIME ZONE tz] INTO DATE d TIME t [FRACTIONAL SECONDS f] [DAYLIGHT SAVING TIME dst] [TIME ZONE tz]
        // CONVERT DATE d [TIME t [DAYLIGHT SAVING TIME dst]] INTO UTCLONG ts | TIME STAMP ts TIME ZONE tz
        // CONVERT TIME STAMP ts TIME ZONE tz INTO DATE d TIME t [DAYLIGHT SAVING TIME dst]
        const KW = ['UTCLONG', 'DATE', 'TIME', 'INTO', 'FRACTIONAL', 'DAYLIGHT', 'ZONE', 'STAMP', 'SECONDS', 'SAVING'];
        const valAt = k => { let e = k; while (e < st.length && !KW.includes(w[e])) e++; return st.slice(k, e); };
        const ii = w.indexOf('INTO');
        const src = w.slice(1, ii), dst = w.slice(ii + 1);
        const tzi = w.lastIndexOf('ZONE');
        const tz = tzi > 0 ? new Expr(valAt(tzi + 1), this).value().js : "'UTC'";
        const at = (from, word, off = 1) => { const k = w.indexOf(word, from); return k > 0 ? k + off : -1; };
        const out = [];
        if (src[0] === 'UTCLONG' || (src[0] === 'TIME' && src[1] === 'STAMP')) {
          const vi = src[0] === 'UTCLONG' ? 2 : 3;
          const r = this.t();
          out.push(`const ${r} = $rt.tsToLocal(${new Expr(valAt(vi), this).value().js}, ${tz}, ${src[0] === 'UTCLONG'});`);
          const di = at(ii, 'DATE'), ti = w.indexOf('TIME', ii + 1), fi = at(ii, 'FRACTIONAL', 2), dsi = at(ii, 'DAYLIGHT', 3);
          if (di > 0) out.push(this.assign(this.target(valAt(di), st), `${r}.date`, false));
          if (ti > 0 && w[ti + 1] !== 'ZONE') out.push(this.assign(this.target(valAt(ti + 1), st), `${r}.time`, false));
          if (fi > 0) out.push(this.assign(this.target(valAt(fi), st), `${r}.frac`, false));
          if (dsi > 0) out.push(this.assign(this.target(valAt(dsi), st), `${r}.dst`, false));
        } else {
          const d = new Expr(valAt(2), this).value().js;
          const ti = w.indexOf('TIME', 2);
          const t = ti > 0 && ti < ii && w[ti + 1] !== 'ZONE' ? new Expr(valAt(ti + 1), this).value().js : "'000000'";
          const utclong = dst[0] === 'UTCLONG';
          const vi = utclong ? ii + 2 : ii + 3;
          out.push(this.assign(this.target(valAt(vi), st), `$rt.localToTs(${d}, ${t}, ${tz}, ${utclong})`, false));
        }
        return [`${tag}{ ${out.join(' ')} }`, i + 1];
      }
      case 'AUTHORITY-CHECK': {
        // AUTHORITY-CHECK OBJECT 'Z_OBJ' [FOR USER u] ID 'F1' FIELD v1 ID 'F2' DUMMY ...
        const obj = new Expr([st[2]], this).value().js;
        const fields = [];
        for (let k = 3; k < st.length; k++) {
          if (w[k] !== 'ID') continue;
          const name = new Expr([st[k + 1]], this).value().js;
          if (w[k + 2] === 'DUMMY') { fields.push(`[${name}, undefined]`); k += 2; continue; }
          let e = k + 3;
          while (e < st.length && w[e] !== 'ID') e++;
          fields.push(`[${name}, ${new Expr(st.slice(k + 3, e), this).value().js}]`);
          k = e - 1;
        }
        const fu = w.indexOf('FOR');
        const user = fu > 0 && w[fu + 1] === 'USER' ? new Expr([st[fu + 2]], this).value().js : 'null';
        return [`${tag}$rt.sy.subrc = $rt.authorityCheck(${obj}, Object.fromEntries([${fields.join(', ')}]), ${user});`, i + 1];
      }
      case 'RESUME': {
        if (!this.inResumeHandler) this.err('RESUME is only possible in CATCH BEFORE UNWIND', st);
        return [`${tag}return $rt.RESUME;`, i + 1];
      }
      case 'RETRY': {
        if (!this.tryLabels?.length) this.err('RETRY outside of CATCH', st);
        return [`continue ${this.tryLabels[this.tryLabels.length - 1]};`, i + 1];
      }
      case 'SET': {
        if (w[1] === 'PARAMETER') return [`${tag}$rt.sapMemory.set($rt.s(${new Expr(st.slice(3, w.indexOf('FIELD')), this).value().js}).toUpperCase(), $rt.clone(${new Expr(st.slice(w.indexOf('FIELD') + 1), this).value().js}));`, i + 1];
        if (w[1] === 'LOCKS') return [`/* SET LOCKS: no-op */`, i + 1];
        if (w[1] === 'HANDLER') {
          // SET HANDLER h1 h2 FOR obj | FOR ALL INSTANCES [ACTIVATION flag]
          const fi = w.indexOf('FOR');
          const ai = w.indexOf('ACTIVATION');
          const handlers = st.slice(2, fi).map(h => { const segs = splitPath(h.v); const m = segs.pop().name.toLowerCase(); return `[${segs.length ? this.readPath(h.v.slice(0, h.v.length - m.length - 2)) : 'this'}, ${Q(m)}]`; });
          const target = w[fi + 1] === 'ALL' ? 'null' : new Expr(st.slice(fi + 1, ai < 0 ? undefined : ai), this).value().js;
          const act = ai < 0 ? 'true' : `!$rt.initial(${new Expr(st.slice(ai + 1), this).value().js})`;
          return [`${tag}$rt.setHandler([${handlers.join(', ')}], ${target}, ${act});`, i + 1];
        }
        break;
      }
    }
    if (kw === 'ENDLOOP' || kw === 'ENDIF') this.err(`Unexpected ${kw}`, st);
    // assignment?
    const ai = findAssignOp(st);
    if (ai > 0) {
      const tgt = this.target(st.slice(0, ai), st);
      const op = st[ai].v;
      const ex = new Expr(st.slice(ai + 1), this, tgt);
      const v = ex.value();
      if (!ex.done()) this.err(`Unexpected '${ex.peek().v}' in expression`, st);
      // DATA(x) = `text` / |template| / CONV string( ): x is a string (keeps its blanks in templates)
      const r0 = st[ai + 1], r1 = String(st[ai + 2]?.v || '').toLowerCase();
      if (isKw(st[0], 'DATA', 'FINAL') && st[1]?.v === '(' && (r0?.t === 'str' || r0?.t === 'tpl' || (/^(COND|SWITCH|CONV)$/i.test(String(r0?.v)) && r1 === 'string') || (st.length === ai + 2 && v.etype === 'string')))
        this.varTypes.set(String(st[2].v).toLowerCase(), [{ t: 'id', v: 'string' }]);
      // DATA(x) = value: x has the value's type (a variable's, a typed constructor's, the calculation type ...)
      else if (isKw(st[0], 'DATA', 'FINAL') && st[1]?.v === '(' && v.spec && op === '=') this.varSpecs.set(String(st[2].v).toLowerCase(), v.spec);
      // a time or date into a number: seconds / days (ABAP's conversion rule for t and d)
      if (op === '=' && (v.etype === 't' || v.etype === 'd') && tgt.name && ['i', 'int8', 'p', 'f', 'decfloat16', 'decfloat34'].includes(this.specOfName(tgt.name)?.k)) return [tag + this.assign(tgt, v.etype === 't' ? `$rt.tsec(${v.js})` : `$rt.dnum(${v.js})`, true), i + 1];
      // a packed number into text: with the decimals of its type (c: sign at the end)
      if (op === '=' && v.spec?.k === 'p' && v.spec.dec > 0 && tgt.name && ['c', 'string'].includes(this.specOfName(tgt.name)?.k)) return [tag + this.assign(tgt, `$rt.pstr(${v.js}, ${v.spec.dec}, ${this.specOfName(tgt.name).k === 'c' ? 1 : 0})`, true), i + 1];
      if (op === '=' || op === '?=') return [tag + this.assign(tgt, v.kind === 'ref' ? `$rt.clone(${v.js})` : v.js, true), i + 1];
      if (op === '&&=') return [tag + this.assign(tgt, `($rt.s(${tgt.read}) + $rt.s(${v.js}))`, false), i + 1];
      const bin = { '+=': '+', '-=': '-', '*=': '*', '/=': '/' }[op];
      return [tag + this.assign(tgt, `$rt.arith(${Q(bin)}, ${tgt.read}, ${v.js})`, false), i + 1];
    }
    // method call statement
    if (st[0].t === 'id' && (st[1]?.v === '(' && !st[1].ws)) return [tag + this.callStatement(st, st, false), i + 1];
    this.err(`Unsupported statement '${w.slice(0, 3).join(' ')}'`, st);
  }

  // ---- targets & assignment -----------------------------------------------------------------
  // returns { set(js) -> statement, read: js }
  target(toks, st) {
    if (!toks.length) this.err('Missing target', st);
    // DATA(x) / FINAL(x) inline declarations
    if (isKw(toks[0], 'DATA', 'FINAL') && toks[1]?.v === '(' && !toks[1].ws) {
      const name = toks[2].v;
      const js = this.declare(name);
      return { kind: 'var', js, read: js, inline: true };
    }
    if (toks[0].t === 'p' && toks[0].v === '@') return this.target(toks.slice(1), st);
    if (isKw(toks[0], 'FIELD-SYMBOL') && toks[1]?.v === '(') {
      const js = this.declare(toks[2].v);
      return { kind: 'var', js, read: js };
    }
    // table expressions as targets: itab[ idx ] = v, m[ i ][ j ] = v, itab[ key = x ]-comp = v
    if (toks.length > 1 && toks[0].t === 'id' && toks[1].t === 'p' && toks[1].v === '[' && !toks[1].ws) {
      const ex = new Expr(toks, this);
      ex.next();
      let tab = ex.pathJs(toks[0].v);
      let idx = ex.tableIndexJs(tab);
      while (ex.isP('[') && !ex.peek().ws) { tab = `$rt.tabRow(${tab}, ${idx})`; idx = ex.tableIndexJs(tab); }
      const path = [];
      // the component path after ]: "-comp" (one token), "-" "comp", or a dynamic "-( name )"
      let derefRow = false;
      while (!ex.done()) {
        if (ex.isP('-') && ex.isP('>', 1) && !path.length) { ex.next(); ex.next(); derefRow = true; if (ex.isP('(')) { ex.next(); path.push({ dyn: ex.value().js }); ex.expectP(')'); } continue; }   // itab_ref[ 1 ]->comp / ->('COMP')
        if (ex.isP('-') && ex.isP('(', 1)) { ex.next(); ex.next(); path.push({ dyn: ex.value().js }); ex.expectP(')'); continue; }
        if (ex.isP('-')) { ex.next(); path.push(ex.next().v.toLowerCase()); continue; }
        const pt = ex.peek();
        if ((pt.t === 'id' || pt.t === 'sel') && String(pt.v).startsWith('-')) { ex.next(); path.push(...String(pt.v).slice(1).toLowerCase().split('-')); continue; }
        break;
      }
      if (!ex.done()) this.err(`Unexpected '${ex.peek().v}' in assignment target`, st);
      const row = derefRow ? `$rt.deref($rt.tabRow(${tab}, ${idx}))` : `$rt.tabRow(${tab}, ${idx})`;
      if (!path.length) return { kind: 'tabcell', tab, idx, js: row, read: row };
      if (path.some(p => typeof p === 'object')) {
        const keys = path.map(p => (typeof p === 'object' ? `$rt.s(${p.dyn}).toLowerCase()` : Q(p)));
        const read = keys.reduce((js, k) => `${js}?.[${k}]`, row);
        return { kind: 'path', base: row, path: [], pathJs: `[${keys.join(', ')}]`, js: read, read };
      }
      const read = readChain(row, path);
      return { kind: 'path', base: row, path, js: read, read };
    }
    // dobj+off(len) = ... / dobj(len) = ...
    if (toks.length > 1 && toks[0].t === 'id' && ((toks[1].t === 'p' && toks[1].v === '+' && !toks[1].ws) || (toks[1].t === 'p' && toks[1].v === '(' && !toks[1].ws && toks[2] && !toks[2].ws))) {
      const base = this.target([toks[0]], st);
      let k = 1, off = '0', len = 'undefined';
      if (toks[k].v === '+') { off = toks[k + 1].t === 'num' ? toks[k + 1].v : this.readPath(toks[k + 1].v); k += 2; }
      if (toks[k]?.v === '(') { len = toks[k + 1].t === 'num' ? toks[k + 1].v : toks[k + 1].v === '*' ? 'undefined' : this.readPath(toks[k + 1].v); }
      return { ...base, subOff: off, subLen: len };
    }
    // dynamic components: struc-('COMP') = v, dref->('COMP') = v, <fs>-('COMP')-('SUB') = v
    if (toks.length > 3 && toks[0].t === 'id' && toks[1].t === 'p' && toks[1].v === '-' && !toks[1].ws) {
      const ex2 = new Expr(toks, this);
      const head = ex2.next();
      let baseJs = this.readPath(head.v);
      const keys = [];
      let ok = true;
      while (!ex2.done()) {
        if (!ex2.isP('-')) { ok = false; break; }
        ex2.next();
        if (ex2.isP('>')) { ex2.next(); if (!keys.length) baseJs = `$rt.deref(${baseJs})`; else { ok = false; break; } }
        if (!ex2.isP('(')) { ok = false; break; }
        ex2.next(); keys.push(`$rt.s(${ex2.value().js}).toLowerCase()`); ex2.expectP(')');
      }
      if (ok && keys.length) return { kind: 'path', base: baseJs, path: [], pathJs: `[${keys.join(', ')}]`, read: keys.reduce((js, k) => `${js}?.[${k}]`, baseJs) };
    }
    const ex = new Expr(toks, this);
    // table expression target: itab[ ... ]-comp
    if (toks.length > 1) {
      const v = ex.postfixTarget();
      if (!ex.done()) this.err(`Unexpected '${ex.peek().v}' in assignment target`, st);
      return v;
    }
    if (/->\*$/.test(toks[0].v)) {
      // dref->* = value
      const r = this.readPath(toks[0].v.replace(/->\*$/, ''));
      return { kind: 'deref', js: r, read: `$rt.deref(${r})` };
    }
    const v = toks[0].v;
    const segs = splitPath(v);
    const baseName = segs[0].name.toLowerCase();
    let baseJs;
    if (segs.length === 1) {
      const js = this.lookup(baseName);
      if (js) return { kind: segs[0].name.startsWith('<') ? 'fs' : 'var', js, read: js, name: baseName };
      if (this.cls.instanceAttrs.has(baseName)) return { kind: 'var', js: `this${prop(baseName)}`, read: `this${prop(baseName)}`, name: baseName };
      if (this.cls.staticAttrs.has(baseName)) return { kind: 'var', js: `$cls${prop(baseName)}`, read: `$cls${prop(baseName)}`, name: baseName };
      if (baseName.includes('~')) return { kind: 'var', js: `this${prop(baseName)}`, read: `this${prop(baseName)}` };
      // not declared here: an attribute of a superclass in another file (resolved at runtime), else an error
      const superElsewhere = this.cls.def.superName && !this.cls.defs.has(this.cls.def.superName);
      if (superElsewhere) return { kind: 'inherited', js: `this${prop(baseName)}`, read: `$rt.g(this, ${Q(baseName)})`, name: baseName };
      return { kind: 'var', js: `this${prop(baseName)}`, read: `this${prop(baseName)}`, unknown: baseName };
    }
    baseJs = this.resolveBase(segs[0].name, segs[1].op, true);
    const path = segs.slice(1).map(s => s.name.toLowerCase());
    if (segs[1].op === '->' || segs[1].op === '=>') {
      // obj->attr or cls=>attr (+ maybe -comp); dref->comp writes into the referenced structure
      const head = segs[1].op === '->' ? `$rt.deref(${baseJs})${prop(path[0])}` : `${baseJs}${prop(path[0])}`;
      if (path.length === 1) return { kind: 'var', js: head, read: head };
      return { kind: 'path', base: head, path: path.slice(1), read: readChain(head, path.slice(1)) };
    }
    return { kind: 'path', base: baseJs, path, read: readChain(baseJs, path), name: segs.every(x => x.op === '-' || x === segs[0]) ? v.toLowerCase() : null };
  }

  // JS evaluating to the internal table behind a target (creates missing component tables)
  tabRef(tgt) {
    if (tgt.kind === 'path') return `$rt.tabAt(${tgt.base}, ${JSON.stringify(tgt.path)})`;
    return tgt.read;
  }

  assign(tgt, valueJs, plain) {
    if (tgt.unknown) this.err(`Unknown variable '${tgt.unknown}'`, { line: '?' });
    if (tgt.subOff !== undefined) {
      const { subOff, subLen, ...base } = tgt;
      return this.assign(base, `$rt.overlay(${base.read}, ${subOff}, ${subLen}, ${valueJs})`, false);
    }
    // ABAP's conversion into the target's type (rounding, length, range); arithmetic results overflow as such
    const spec = tgt.name && (tgt.kind === 'var' || tgt.kind === 'path') ? this.specOfName(tgt.name) : null;
    const conv = v => spec && CONVERTED.has(spec.k) ? `$rt.cv(${JSON.stringify(spec)}, ${v}${v.includes('$rt.arith(') ? ', 1' : ''})` : v;
    if (tgt.kind === 'var') return `${tgt.js} = ${conv(valueJs)};`;
    if (tgt.kind === 'inherited') return `$rt.setg(this, ${Q(tgt.name)}, ${valueJs});`;
    if (tgt.kind === 'deref') return `$rt.setDeref(${tgt.js}, ${valueJs});`;
    if (tgt.kind === 'tabcell') return `$rt.tabSet(${tgt.tab}, ${tgt.idx}, ${valueJs});`;
    if (tgt.kind === 'fs') return `${tgt.js} = $rt.fsAssign(${tgt.js}, ${valueJs});`;
    return `$rt.setp(${tgt.base}, ${tgt.pathJs || JSON.stringify(tgt.path)}, ${conv(valueJs)});`;
  }

  // split a token list into targets: a DATA(b) <c> ...
  targetList(toks, st) {
    const out = [];
    for (let k = 0; k < toks.length; k++) {
      if (isKw(toks[k], 'DATA', 'FINAL') && toks[k + 1]?.v === '(' && !toks[k + 1].ws) { out.push(this.target(toks.slice(k, k + 4), st)); k += 3; }
      else out.push(this.target([toks[k]], st));
    }
    return out;
  }

  // initial value of a line of a table variable (declared TYPE [STANDARD|SORTED|HASHED] TABLE OF <line> ...)
  lineInitOf(name) {
    const ln = name.toLowerCase();
    let tt = this.varTypes.get(ln);
    if (!tt && !this.lookup(ln)) for (let d = this.cls.def; d && !tt; d = d.superName ? this.cls.defs.get(d.superName) : null) tt = d.attrs.find(a => a.name === ln)?.typeToks;
    for (let depth = 0; tt && depth < 4; depth++) {
      const w = tt.map(t => String(t.v).toUpperCase());
      const of = w.indexOf('OF');
      if (w.includes('TABLE') && of >= 0) {
        const line = [];
        for (let k = of + 1; k < tt.length && !['WITH', 'INITIAL'].includes(w[k]); k++) line.push(tt[k]);
        return line.length ? initForType(line, false, this.cls) : null;
      }
      const ut = this.localTypes?.get(String(tt[0]?.v).toLowerCase()) || this.cls.lookupType(String(tt[0]?.v).toLowerCase());
      tt = ut && !ut.struct ? ut.typeToks : null;
    }
    return null;
  }
  // ---- static types: ABAP is statically typed, values at runtime are plain JS values; the compiler knows each
  // declared type and converts into it on assignment (fixed length c/n/x, p with its length and decimals, i range ...)
  // spec: { k: 'i' | 'int8' | 'p' | 'f' | 'decfloat16' | 'decfloat34' | 'c' | 'n' | 'x' | 'string' | 'xstring' | 'd' | 't'
  //         | 'utclong', len, dec } | { k: 'struct', comps: { name: spec } } | { k: 'table', line: spec } | null (unknown)
  typeSpec(tt, depth = 0) {
    if (!tt?.length || depth > 8) return null;
    const w = tt.map(t => String(t.v).toUpperCase());
    if (w[0] === 'REF' || w[0] === 'RANGE' || w[0] === 'LINE') return null;
    if (w.includes('TABLE')) {
      const of = w.indexOf('OF'), line = [];
      if (of >= 0) for (let k = of + 1; k < tt.length && !['WITH', 'INITIAL', 'REF'].includes(w[k]); k++) line.push(tt[k]);
      return { k: 'table', line: line.length && !w.slice(of + 1).includes('REF') ? this.typeSpec(line, depth + 1) : null };
    }
    const n = String(tt[0].v).toLowerCase();
    const num = kw => { const i = w.indexOf(kw); return i >= 0 && tt[i + 1]?.t === 'num' ? Number(tt[i + 1].v) : undefined; };
    if (BUILTIN_SPECS[n]) {
      const b = BUILTIN_SPECS[n];
      return { k: b.k, len: b.fixed ? b.len : num('LENGTH') ?? b.len, dec: b.k === 'p' ? (b.fixed ? b.dec ?? 0 : num('DECIMALS') ?? 0) : undefined };
    }
    const ut = this.localTypes?.get(n) || this.cls.lookupType(n);
    if (ut) return ut.struct ? this.structSpec(ut.struct, depth + 1) : ut.like ? null : this.typeSpec(ut.typeToks, depth + 1);
    // a type of a global interface or class: zif_x=>ty_s (typed in the context of its owner)
    if (n.includes('=>')) {
      const [on, tn] = n.split('=>');
      const od = this.cls.defs.get(on) || KNOWN_INTERFACES.get(on) || KNOWN_CLASSES.get(on);
      const t = od?.types.get(tn);
      if (t) return t.struct ? specIn(this, od, null, t.struct, depth + 1) : t.like ? null : specIn(this, od, t.typeToks, null, depth + 1);
    }
    // a type of the dictionary: a data element (CURR 15,2 -> p with 2 decimals), a table or structure (zpo_head),
    // or a component of one (zpo_head-netwr)
    if (DDIC_SPEC && !n.includes('=>')) {
      const [head, ...comps] = n.split('-');
      let sp = DDIC_SPEC(head);
      for (const c of comps) sp = sp?.k === 'struct' ? sp.comps[c] ?? null : null;
      return sp || null;
    }
    return null;
  }
  structSpec(comps, depth = 0) {
    const out = {};
    for (const c of comps || []) {
      if (c.include) { const inc = this.typeSpec(c.include, depth + 1); if (inc?.k === 'struct') Object.assign(out, inc.comps); continue; }
      out[c.name.toLowerCase()] = c.struct ? this.structSpec(c.struct, depth + 1) : c.like ? null : this.typeSpec(c.typeToks, depth + 1);
    }
    return { k: 'struct', comps: out };
  }
  // the static type of a variable, parameter or attribute, also of a component path (ls_x-comp-sub)
  specOfName(name) {
    const parts = String(name).toLowerCase().split('-');
    const ln = parts[0];
    if (!/^<?[a-z_][\w]*>?$/.test(ln)) return null;
    let spec = this.varSpecs.get(ln);
    if (spec === undefined) {
      let tt = this.varTypes.get(ln), attr = null;
      if (!tt && !this.lookup(ln)) for (let d = this.cls.def; d && !tt && !attr; d = d.superName ? this.cls.defs.get(d.superName) : null) attr = d.attrs.find(a => a.name === ln) || null;
      if (attr) spec = attr.struct ? this.structSpec(attr.struct) : attr.like ? null : this.typeSpec(attr.typeToks);
      else spec = tt ? this.typeSpec(tt) : null;
    }
    for (const c of parts.slice(1)) spec = spec?.k === 'struct' ? spec.comps[c] ?? null : null;
    return spec ?? null;
  }
  // elementary type of a variable, parameter or attribute: { t: 'i' | 'p' | 't' | 'd' | 'f' | 'string' | 'c' | ..., dec }
  elemTypeOf(name) {
    const ln = name.toLowerCase();
    if (!/^[a-z_][\w]*$/.test(ln)) return null;
    const sp = this.specOfName(ln);
    return sp && sp.k !== 'struct' && sp.k !== 'table' ? { t: sp.k, dec: sp.dec, len: sp.len } : null;
  }
  refTypeOf(name) {
    const ln = name.toLowerCase().replace(/^this\./, '').replace(/^\$cls\./, '');
    let tt = this.varTypes.get(ln);
    if (!tt) {
      for (let d = this.cls.def; d && !tt; d = d.superName ? this.cls.defs.get(d.superName) : null) tt = d.attrs.find(a => a.name === ln)?.typeToks;
    }
    if (!tt) return null;
    const w = tt.map(t => t.v.toUpperCase());
    if (w[0] === 'REF' && w[1] === 'TO') return tt[2].v.toLowerCase();
    return null;
  }

  // ---- name resolution -----------------------------------------------------------------------
  resolveBase(name, nextOp, forWrite = false) {
    const ln = name.toLowerCase();
    if (nextOp === '=>') return ln === this.cls.def.name ? '$cls' : `$rt.cls(${Q(ln)})`;
    if (ln === 'me') return 'this';
    if (ln === 'super') return 'super';
    const local = this.lookup(ln);
    if (local) return local;
    if (ln === 'sy' || ln === 'syst') return '$rt.sy';
    if (this.cls.instanceAttrs.has(ln)) return `this${prop(ln)}`;
    if (this.cls.staticAttrs.has(ln)) return `$cls${prop(ln)}`;
    if (ln.includes('~')) return `this${prop(ln)}`;
    if (ln === 'abap_true') return '"X"';
    if (ln === 'abap_false' || ln === 'space') return '""';
    if (ln === 'abap_undefined') return '"-"';
    return `$rt.g(this, ${Q(ln)})`;
  }

  readPath(v) {
    const segs = splitPath(v);
    let js = this.resolveBase(segs[0].name, segs[1]?.op);
    for (let k = 1; k < segs.length; k++) js = applySeg(js, segs[k]);
    return js;
  }

  // ---- conditions ----------------------------------------------------------------------------
  cond(toks, st) {
    const ex = new Expr(toks, this);
    const c = ex.cond();
    if (!ex.done()) this.err(`Unexpected '${ex.peek().v}' in condition`, st);
    return c;
  }

  // ---- loops ---------------------------------------------------------------------------------
  loopAt(stmts, i, st, w, tag) {
    const [body, k] = this.collect(stmts, i + 1, ['ENDLOOP']);
    void body;
    if (w[1] !== 'AT') this.err('Only LOOP AT is supported', st);
    // LOOP AT GROUP grp INTO member ...: iterate the members of the current group
    let groupMembers = null;
    let loopToks = st.slice(2);
    if (w[2] === 'GROUP') {
      groupMembers = `gm$${jsVar(st[3].v.replace(/^me->/i, ''))}`;
      this.declared.add(groupMembers);
      loopToks = st.slice(4);
    }
    // LOOP AT itab ... GROUP BY key [ASCENDING|DESCENDING] [WITHOUT MEMBERS] [INTO grp | ASSIGNING <grp>]
    let gb = -1, depth = 0;
    for (let k = 0; k < loopToks.length; k++) {
      const t = loopToks[k];
      if (t.t === 'p' && (t.v === '(' || t.v === '[')) depth++;
      if (t.t === 'p' && (t.v === ')' || t.v === ']')) depth--;
      if (!depth && isKw(t, 'GROUP') && isKw(loopToks[k + 1], 'BY')) { gb = k; break; }
    }
    if (gb >= 0) return this.loopGroupBy(stmts, i, st, loopToks.slice(0, gb), loopToks.slice(gb + 2), tag, k, groupMembers);
    // LOOP AT itab [INTO wa | ASSIGNING <fs> | REFERENCE INTO r | TRANSPORTING NO FIELDS] [FROM a] [TO b] [WHERE cond]
    const kws = ['INTO', 'ASSIGNING', 'REFERENCE', 'TRANSPORTING', 'FROM', 'TO', 'WHERE', 'USING', 'STEP'];
    const parts = splitByKeywords(loopToks, kws);
    const itab = groupMembers || new Expr(parts[''], this).value().js;
    const t = this.t();
    const row = `${t}r`;
    let bind = '';
    let whereJs = null;
    // binding target must be declared before WHERE refers to it
    let wa = null;
    if (parts.INTO) { wa = this.target(parts.INTO, st); bind = this.assign(wa, `$rt.clone(${row})`, false); }
    if (parts.ASSIGNING) { wa = this.target(parts.ASSIGNING, st); bind = `${wa.js} = ${row};`; }
    if (parts.REFERENCE) { wa = this.target(parts.REFERENCE.slice(1), st); bind = `${wa.js} = $rt.rowRef(${t}a, ${t});`; }
    if (parts.WHERE) whereJs = this.rowCond(parts.WHERE, row, st);
    const fromJs = parts.FROM ? `$rt.n(${new Expr(parts.FROM, this).value().js}) - 1` : null;
    const toJs = parts.TO ? `$rt.n(${new Expr(parts.TO, this).value().js})` : null;
    const stepJs = parts.STEP ? new Expr(parts.STEP, this).value().js : null;
    // STEP n: every n-th line; a negative step runs backwards, from the last line (or FROM) down to the first (or TO)
    const loopPre = stepJs ? ` const ${t}s = $rt.n(${stepJs}); if (!${t}s) throw $rt.new('cx_sy_itab_line_not_found', {});` : '';
    const loopHead = stepJs
      ? `for (let ${t} = ${fromJs ?? `(${t}s < 0 ? ${t}a.length - 1 : 0)`}; ${t}s < 0 ? ${t} >= ${toJs ? `${toJs} - 1` : '0'} : ${t} < ${toJs ? `Math.min(${t}a.length, ${toJs})` : `${t}a.length`}; ${t} += ${t}s)`
      : `for (let ${t} = ${fromJs ?? '0'}; ${t} < ${toJs ? `Math.min(${t}a.length, ${toJs})` : `${t}a.length`}; ${t}++)`;
    const L = this.enterLoop();
    let b = this.block(body);
    this.leaveLoop();
    // a field symbol on a row of an elementary table (strings, numbers): what is assigned to it goes back into the row
    if (parts.ASSIGNING) b = `try {\n${b}\n} finally { if (typeof ${row} !== 'object' && ${wa.js} !== ${row} && ${t}a[${t}] === ${row}) ${t}a[${t}] = ${wa.js}; }`;
    const js = `${tag}{ const ${t}a = ${itab}; let ${t}hit = false;${loopPre}
${L}: ${loopHead} { const ${row} = ${t}a[${t}];${whereJs ? ` if (!(${whereJs})) continue;` : ''} ${t}hit = true; $rt.sy.tabix = ${t} + 1; ${bind}
${b}
}
$rt.sy.subrc = ${t}hit ? 0 : 4; }`;
    return [js, k + 1];
  }

  // srcJs: the members of the current group (LOOP AT GROUP grp ... GROUP BY: groups within a group)
  loopGroupBy(stmts, i, st, head, groupToks, tag, k, srcJs = null) {
    const [body] = this.collect(stmts, i + 1, ['ENDLOOP']);
    const parts = splitByKeywords(head, ['INTO', 'ASSIGNING', 'REFERENCE', 'TRANSPORTING', 'WHERE']);
    const itab = srcJs || new Expr(parts[''], this).value().js;
    const t = this.t();
    const row = `${t}r`;
    let wa = null, bindRow = '';
    if (parts.INTO) { wa = this.target(parts.INTO, st); bindRow = this.assign(wa, `$rt.clone(${row})`, false); }
    if (parts.ASSIGNING) { wa = this.target(parts.ASSIGNING, st); bindRow = `${wa.js} = ${row};`; }
    if (parts.REFERENCE) { wa = this.target(parts.REFERENCE.slice(1), st); bindRow = `${wa.js} = ${row};`; }
    const whereJs = parts.WHERE ? this.rowCond(parts.WHERE, row, st) : null;
    // group key
    const ex = new Expr(groupToks, this);
    let keyJs, sizeComp = null, indexComp = null;
    if (ex.isP('(') && ex.peek(1)?.t === 'id' && ex.isP('=', 2)) {
      ex.next();
      const comps = [];
      while (!ex.isP(')')) {
        const c = ex.next().v.toLowerCase();
        ex.expectP('=');
        if (ex.isKw('GROUP') && isKw(ex.peek(1), 'SIZE')) { ex.next(); ex.next(); sizeComp = c; continue; }
        if (ex.isKw('GROUP') && isKw(ex.peek(1), 'INDEX')) { ex.next(); ex.next(); indexComp = c; continue; }
        comps.push(`${Q(c)}: ${ex.value().js}`);
      }
      ex.next();
      keyJs = `{ ${comps.join(', ')} }`;
    } else keyJs = ex.value().js;
    let order = 0, withoutMembers = false, grp = null, grpAssign = false;
    while (!ex.done()) {
      if (ex.isKw('ASCENDING')) { ex.next(); order = 1; if (ex.isKw('AS')) { ex.next(); ex.next(); } continue; }
      if (ex.isKw('DESCENDING')) { ex.next(); order = -1; if (ex.isKw('AS')) { ex.next(); ex.next(); } continue; }
      if (ex.isKw('WITHOUT')) { ex.next(); ex.next(); withoutMembers = true; continue; }
      if (ex.isKw('INTO')) { ex.next(); grp = this.target(ex.targetToks(), st); continue; }
      if (ex.isKw('ASSIGNING')) { ex.next(); grp = this.target(ex.targetToks(), st); grpAssign = true; continue; }
      if (ex.isKw('REFERENCE')) { ex.next(); ex.next(); grp = this.target(ex.targetToks(), st); continue; }
      this.err(`Unexpected '${ex.peek().v}' in GROUP BY`, st);
    }
    void withoutMembers; void grpAssign;
    // members of the current group are kept in gm$<name> for LOOP AT GROUP / FOR ... IN GROUP
    const memberVar = grp ? `gm$${jsVar(grp.js.replace(/^(this|\$cls)\./, ''))}` : wa ? `gm$${jsVar(wa.js.replace(/^(this|\$cls)\./, ''))}` : `${t}gm`;
    this.declared.add(memberVar);
    const L = this.enterLoop();
    const b = this.block(body);
    this.leaveLoop();
    const keyFix = (sizeComp || indexComp) ? ` ${t}g.key = Object.assign($rt.clone(${t}g.key), {${sizeComp ? ` ${Q(sizeComp)}: ${t}g.members.length,` : ''}${indexComp ? ` ${Q(indexComp)}: ${t}n + 1` : ''} });` : '';
    const js = `${tag}{ const ${t}a = ${itab}; const ${t}m = new Map();
for (let ${t} = 0; ${t} < ${t}a.length; ${t}++) { const ${row} = ${t}a[${t}];${whereJs ? ` if (!(${whereJs})) continue;` : ''} ${bindRow}
  const ${t}k = ${keyJs}; const ${t}s = JSON.stringify(${t}k); if (!${t}m.has(${t}s)) ${t}m.set(${t}s, { key: ${t}k, members: [] }); ${t}m.get(${t}s).members.push(${row}); }
const ${t}l = [...${t}m.values()];${order ? ` ${t}l.sort((x, y) => ${order} * $rt.cmp(typeof x.key === 'object' ? JSON.stringify(x.key) : x.key, typeof y.key === 'object' ? JSON.stringify(y.key) : y.key));` : ''}
${L}: for (let ${t}n = 0; ${t}n < ${t}l.length; ${t}n++) { const ${t}g = ${t}l[${t}n];${keyFix} ${memberVar} = ${t}g.members; $rt.sy.tabix = ${t}n + 1;
${grp ? this.assign(grp, `${t}g.key`, false) : wa ? this.assign(wa, parts.ASSIGNING || parts.REFERENCE ? `${t}g.members[0]` : `$rt.clone(${t}g.members[0])`, false) : ''}
${b}
} }`;
    return [js, k + 1];
  }

  // condition where bare component names refer to the row (LOOP WHERE, DELETE WHERE, FOR WHERE)
  rowCond(toks, rowJs, st) {
    const ex = new Expr(toks, this);
    ex.rowJs = rowJs;
    const c = ex.cond();
    if (!ex.done()) this.err(`Unexpected '${ex.peek().v}' in WHERE condition`, st);
    return c;
  }

  tryBlock(stmts, i, tag) {
    const [body, k] = this.collect(stmts, i + 1, ['CATCH', 'CLEANUP', 'ENDTRY']);
    let j = k;
    const catches = [];
    let cleanup = null;
    while (!isKw(stmts[j][0], 'ENDTRY')) {
      const cst = stmts[j];
      const [cb, k2] = this.collect(stmts, j + 1, ['CATCH', 'CLEANUP', 'ENDTRY']);
      if (isKw(cst[0], 'CLEANUP')) cleanup = cb;
      else {
        const cw = cst.map(t => t.v.toUpperCase());
        const into = cw.indexOf('INTO');
        const names = cst.slice(1, into < 0 ? undefined : into).filter(t => !isKw(t, 'BEFORE', 'UNWIND')).map(t => t.v.toLowerCase());
        const tgt = into >= 0 ? this.target(cst.slice(into + 1), cst) : null;
        catches.push({ names, tgt, body: cb, beforeUnwind: cw[1] === 'BEFORE' && cw[2] === 'UNWIND' });
      }
      j = k2;
    }
    const e = this.t();
    const label = `${e}try`;
    // CATCH BEFORE UNWIND: the handler runs at the RAISE (resumable exceptions may RESUME there)
    const bu = catches.filter(c => c.beforeUnwind);
    const handlers = bu.map(c => {
      this.inResumeHandler = (this.inResumeHandler || 0) + 1;
      const fn = `(${e}x) => { ${c.tgt ? this.assign(c.tgt, `$rt.wrapErr(${e}x)`, false) : ''}\n${this.block(c.body)}\n}`;
      this.inResumeHandler--;
      return `{ id: ${Q(e)}, names: ${JSON.stringify(c.names)}, fn: ${fn} }`;
    });
    const tryBody = this.block(body);
    (this.tryLabels ||= []).push(label);
    let js = `${tag}${label}: for (;;) { ${handlers.length ? `$rt.pushHandlers([${handlers.join(', ')}]); ` : ''}try {\n${tryBody}\n} catch (${e}) {\nif ($rt.isControl(${e})) throw ${e};\n`;
    js += catches.map((c, n) => {
      const hit = c.names.map(nm => `$rt.isA(${e}, ${Q(nm)})`).join(' || ');
      // a before-unwind handler that already ran at the RAISE only unwinds here
      if (c.beforeUnwind) return `${n ? 'else ' : ''}if (${hit}) { if (${e}.$unwound !== ${Q(e)}) $rt.handlerFor(${Q(e)}, ${e}); }`;
      return `${n ? 'else ' : ''}if (${hit}) {\n${c.tgt ? this.assign(c.tgt, `$rt.wrapErr(${e})`, false) : ''}\n${this.block(c.body)}\n}`;
    }).join('\n');
    js += `\nelse { ${cleanup ? this.block(cleanup) : ''} throw ${e}; }\n}${handlers.length ? ` finally { $rt.popHandlers(${handlers.length}); }` : ''} break; }`;
    this.tryLabels.pop();
    return [js, j + 1];
  }

  raise(st, w) {
    if (w[1] === 'RESUMABLE' && w[2] === 'EXCEPTION') {
      const ex = w[3] === 'TYPE'
        ? `$rt.new(${Q(st[4].v.toLowerCase())}, ${w[5] === 'EXPORTING' ? new Expr(st.slice(6), this).namedArgs() : '{}'})`
        : new Expr(st.slice(3), this).value().js;
      return `$rt.raiseResumable(${ex});`;
    }
    if (w[1] === 'EXCEPTION') {
      if (w[2] === 'TYPE') {
        const cls = st[3].v.toLowerCase();
        const args = w[4] === 'EXPORTING' ? new Expr(st.slice(5), this).namedArgs() : '{}';
        return `throw $rt.new(${Q(cls)}, ${args});`;
      }
      return `throw ${new Expr(st.slice(2), this).value().js};`;
    }
    if (w[1] === 'ENTITY' && w[2] === 'EVENT') {
      // RAISE ENTITY EVENT bo~event FROM instances
      const fi = w.indexOf('FROM');
      if (fi < 0) this.err('RAISE ENTITY EVENT needs FROM', st);
      return `$rt.eml.raiseEvent(${Q(st.slice(3, fi).map(t => t.v).join('').toLowerCase())}, ${new Expr(st.slice(fi + 1), this).value().js});`;
    }
    if (w[1] === 'EVENT') {
      const args = w[3] === 'EXPORTING' ? new Expr(st.slice(4), this).namedArgs() : '{}';
      return `$rt.raiseEvent(this, ${Q(st[2].v.toLowerCase())}, ${args});`;
    }
    if (w[1] === 'SHORTDUMP') return `throw $rt.new('cx_sy_shortdump', {});`;
    // RAISE name: a classic (non-class-based) exception of the method, caught by the caller's EXCEPTIONS
    if (st.length === 2 && st[1].t === 'id') return `throw $rt.classicException(${Q(st[1].v.toLowerCase())});`;
    this.err('Unsupported RAISE statement', st);
  }

  // ---- internal tables -----------------------------------------------------------------------
  append(st, w) {
    // APPEND LINES OF a [FROM i] [TO j] TO b | APPEND INITIAL LINE TO itab [ASSIGNING <fs>] | APPEND x TO itab [ASSIGNING <fs>|REFERENCE INTO r]
    if (w[1] === 'LINES' && w[2] === 'OF') {
      const parts = splitByKeywords(st.slice(3), ['FROM', 'TO']);
      const src = new Expr(parts[''], this).value().js;
      const dst = this.target(parts.TO, st);
      return `$rt.appendLines(${this.tabRef(dst)}, ${src}, ${parts.FROM ? new Expr(parts.FROM, this).value().js : 'null'});`;
    }
    const parts = splitByKeywords(st.slice(1), ['TO', 'ASSIGNING', 'REFERENCE', 'SORTED']);
    let valJs;
    const emptyValue = parts[''].length === 4 && isKw(parts[''][0], 'VALUE') && parts[''][1].v === '#' && parts[''][2].v === '(' && parts[''][3].v === ')';
    if ((isKw(parts[''][0], 'INITIAL') && isKw(parts[''][1], 'LINE')) || emptyValue) valJs = null;
    else {
      const v = new Expr(parts[''], this).value();
      valJs = v.kind === 'ref' ? `$rt.clone(${v.js})` : v.js;
    }
    const dst = this.target(parts.TO, st);
    const tab = this.tabRef(dst);
    // an initial line: of the declared line type when it is known (a nested table starts as [])
    const init = valJs ?? (dst.name && this.lineInitOf(dst.name)) ?? `$rt.initLine(${tab})`;
    const t = this.t();
    let js = `{ const ${t} = ${init}; const ${t}t = ${tab}; ${t}t.push(${t}); $rt.sy.tabix = ${t}t.length;`;
    if (parts.ASSIGNING) js += ` ${this.target(parts.ASSIGNING, st).js} = ${t};`;
    if (parts.REFERENCE) js += ` ${this.target(parts.REFERENCE.slice(1), st).js} = ${t};`;
    return js + ' }';
  }

  isLocalTable(tok) {
    if (!tok || tok.t !== 'id') return false;
    const segs = splitPath(tok.v);
    const base = segs[0].name.toLowerCase();
    if (segs.length > 1) return true; // components (failed-travel) are always internal tables here
    return !!this.lookup(base) || this.cls.instanceAttrs.has(base) || this.cls.staticAttrs.has(base);
  }

  insert(st, w) {
    // INSERT x INTO TABLE itab | INSERT x INTO itab INDEX n | INSERT LINES OF a INTO TABLE b
    // INSERT dbtab FROM wa | INSERT dbtab FROM TABLE @itab | INSERT INTO dbtab VALUES @wa
    if (w[1] === 'INTO' && !w.includes('TABLE') && w.includes('VALUES')) {
      const tab = st[2].v.toLowerCase();
      const v = new Expr(st.slice(w.indexOf('VALUES') + 1).filter(t => !(t.t === 'p' && t.v === '@')), this).value().js;
      return `$rt.sql.insert(${Q(tab)}, [${v}]);`;
    }
    // keywords at the top level only (not INDEX INTO inside a VALUE #( FOR ... ))
    let depth = 0;
    const top = w.map((x, k) => { if (st[k].t === 'p' && st[k].v === '(') depth++; if (st[k].t === 'p' && st[k].v === ')') depth--; return depth === 0 || (st[k].t === 'p' && st[k].v === '(' && depth === 1) ? x : null; });
    const ii = top.indexOf('INTO');
    if (ii < 0 && top.includes('FROM')) {
      const tab = st[1].v.toLowerCase();
      const fi = w.indexOf('FROM');
      // INSERT dbtab FROM ( SELECT ... ): the rows of the subquery (columns by name)
      if (st[fi + 1]?.v === '(' && isKw(st[fi + 2], 'SELECT')) {
        const tmp = `zz_subquery_${++this.tmp}`;
        this.declare(tmp);
        const sub = st.slice(fi + 2, st.length - 1);
        const at = { t: 'p', v: '@', line: st[0].line }, id = { t: 'id', v: tmp, line: st[0].line };
        return `${new SqlBuilder(this).select([...sub, { t: 'id', v: 'INTO' }, { t: 'id', v: 'TABLE' }, at, id])} $rt.sql.insert(${Q(tab)}, ${jsVar(tmp)});`;
      }
      const isTable = w[fi + 1] === 'TABLE';
      const v = new Expr(st.slice(fi + (isTable ? 2 : 1)).filter(t => !(t.t === 'p' && t.v === '@')), this).value().js;
      return `$rt.sql.insert(${Q(tab)}, ${isTable ? v : `[${v}]`});`;
    }
    if (w[1] === 'LINES' && w[2] === 'OF') {
      const src = new Expr(st.slice(3, ii), this).value().js;
      const parts = splitByKeywords(st.slice(w[ii + 1] === 'TABLE' ? ii + 2 : ii + 1), ['INDEX']);
      const dst = this.target(parts[''], st);
      if (parts.INDEX) return `${this.tabRef(dst)}.splice($rt.n(${new Expr(parts.INDEX, this).value().js}) - 1, 0, ...$rt.clone(${src}));`;
      return `$rt.appendLines(${this.tabRef(dst)}, ${src});`;
    }
    const v = new Expr(st.slice(1, ii), this).value();
    const valJs = v.kind === 'ref' ? `$rt.clone(${v.js})` : v.js;
    const rest = st.slice(ii + 1);
    if (isKw(rest[0], 'TABLE')) {
      const parts = splitByKeywords(rest.slice(1), ['ASSIGNING', 'REFERENCE']);
      const dst = this.target(parts[''], st);
      const t = this.t();
      let bind = '';
      if (parts.ASSIGNING) bind = ` ${this.target(parts.ASSIGNING, st).js} = ${t};`;
      if (parts.REFERENCE) bind = ` ${this.target(parts.REFERENCE.slice(1), st).js} = ${t};`;
      return `{ const ${t} = ${valJs}; $rt.insertTable(${this.tabRef(dst)}, ${t});${bind} }`;
    }
    const parts = splitByKeywords(rest, ['INDEX', 'ASSIGNING']);
    const dst = this.target(parts[''], st);
    const idx = parts.INDEX ? new Expr(parts.INDEX, this).value().js : `${dst.read}.length + 1`;
    return `${dst.read}.splice($rt.n(${idx}) - 1, 0, ${valJs});`;
  }

  modifyStmt(st, w) {
    // MODIFY itab FROM wa [INDEX i] [TRANSPORTING f...] [WHERE cond] | MODIFY dbtab FROM wa | FROM TABLE itab
    const fi = w.indexOf('FROM');
    if (!this.isLocalTable(st[1])) {
      const tab = st[1].v.toLowerCase();
      const isTable = w[fi + 1] === 'TABLE';
      const v = new Expr(st.slice(fi + (isTable ? 2 : 1)).filter(t => !(t.t === 'p' && t.v === '@')), this).value().js;
      return `$rt.sql.modify(${Q(tab)}, ${isTable ? v : `[${v}]`});`;
    }
    const itab = this.readPath(st[1].v);
    const parts = splitByKeywords(st.slice(fi + 1), ['INDEX', 'TRANSPORTING', 'WHERE']);
    const wa = new Expr(parts[''], this).value().js;
    const fields = parts.TRANSPORTING ? JSON.stringify(parts.TRANSPORTING.map(t => t.v.toLowerCase())) : 'null';
    if (parts.WHERE) {
      const t = this.t();
      return `for (const ${t} of ${itab}) { if (${this.rowCond(parts.WHERE, t, st)}) $rt.modifyRow(${t}, ${wa}, ${fields}); }`;
    }
    const idx = parts.INDEX ? new Expr(parts.INDEX, this).value().js : '$rt.sy.tabix';
    return `$rt.modifyRow(${itab}[$rt.n(${idx}) - 1], ${wa}, ${fields});`;
  }

  deleteStmt(st, w) {
    if (w[1] === 'ADJACENT') {
      // DELETE ADJACENT DUPLICATES FROM itab [COMPARING f... | ALL FIELDS]
      const ci = w.indexOf('COMPARING');
      const itab = new Expr(st.slice(4, ci < 0 ? undefined : ci), this).value().js;
      const comps = ci < 0 || w[ci + 1] === 'ALL' ? 'null' : JSON.stringify(st.slice(ci + 1).map(t => t.v.toLowerCase()));
      return `$rt.deleteAdjacent(${itab}, ${comps});`;
    }
    if (w[1] === 'DATASET') return `$rt.datasetDelete(${new Expr(st.slice(2), this).value().js});`;
    if (w[1] === 'FROM' && w[2] === 'MEMORY') return `$rt.freeMemory(${new Expr(st.slice(4), this).value().js});`;
    if (w[1] === 'FROM' && w[2] === 'DATABASE') return `$rt.deleteDataCluster(${Q(String(st[3].v).toLowerCase())}, ${Q(String(st[5]?.v || '').toUpperCase())}, $rt.s(${new Expr(st.slice(w.indexOf('ID') + 1), this).value().js}));`;
    if (w[1] === 'FROM' && !this.isLocalTable(st[2])) {
      // DELETE FROM dbtab WHERE ...
      const tab = st[2].v.toLowerCase();
      const wi = w.indexOf('WHERE');
      if (wi < 0) return `$rt.sql.exec(${Q(`DELETE FROM ${sqlIdent(tab)}`)}, []);`;
      const sq = new SqlBuilder(this);
      const where = sq.translate(st.slice(wi + 1));
      return `$rt.sql.exec(${Q(`DELETE FROM ${sqlIdent(tab)} WHERE ${where}`)}, ${sq.paramsJs()});`;
    }
    if (w[1] === 'TABLE') {
      const itab = this.readPath(st[2].v);
      if (w[3] === 'FROM') return `$rt.deleteFromTable(${itab}, ${new Expr(st.slice(4), this).value().js});`;
      const comps = pairs(st.slice(w.indexOf('KEY') + 1), this);
      return `$rt.deleteWhere(${itab}, (r) => ${comps.map(([c, v]) => `$rt.eq(${rowComp('r', c)}, ${v})`).join(' && ') || 'true'});`;
    }
    if (!this.isLocalTable(st[1]) && w.includes('FROM')) {
      const tab = st[1].v.toLowerCase();
      const fi = w.indexOf('FROM');
      const isTable = w[fi + 1] === 'TABLE';
      const v = new Expr(st.slice(fi + (isTable ? 2 : 1)).filter(t => !(t.t === 'p' && t.v === '@')), this).value().js;
      return `$rt.sql.deleteRows(${Q(tab)}, ${isTable ? v : `[${v}]`});`;
    }
    const itab = this.readPath(st[1].v);
    if (w[2] === 'WHERE') return `$rt.deleteWhere(${itab}, (r) => ${this.rowCond(st.slice(3), 'r', st)});`;
    if (w[2] === 'INDEX') return `${itab}.splice($rt.n(${new Expr(st.slice(3), this).value().js}) - 1, 1);`;
    if (st.length === 2 && this.loopDepth) return `${itab}.splice($rt.sy.tabix - 1, 1);`;
    // DELETE itab [USING KEY k] [FROM i] [TO j] [WHERE cond]: a range of lines; DELETE itab FROM wa: the line with wa's key
    let rest = st.slice(2);
    if (isKw(rest[0], 'USING') && isKw(rest[1], 'KEY')) rest = rest.slice(3);
    if (!rest.length && this.loopDepth) return `${itab}.splice($rt.sy.tabix - 1, 1);`;   // DELETE itab USING KEY loop_key
    const parts = splitByKeywords(rest, ['FROM', 'TO', 'WHERE']);
    if (parts.FROM || parts.TO || parts.WHERE) {
      const fromV = parts.FROM ? new Expr(parts.FROM, this).value() : null;
      const isIndex = parts.TO || !fromV || fromV.lit || ['i', 'int8', 'p', 'n'].includes(fromV.spec?.k);
      if (!isIndex) return `$rt.deleteFromTable(${itab}, ${fromV.js});`;
      const t = this.t();
      const from = fromV ? `$rt.n(${fromV.js})` : '1', to = parts.TO ? `$rt.n(${new Expr(parts.TO, this).value().js})` : `${itab}.length`;
      const cond = parts.WHERE ? this.rowCond(parts.WHERE, `${itab}[${t}]`, st) : 'true';
      return `for (let ${t} = Math.min(${to}, ${itab}.length) - 1; ${t} >= ${from} - 1; ${t}--) if (${cond}) ${itab}.splice(${t}, 1);`;
    }
    this.err('Unsupported DELETE statement', st);
  }

  sortStmt(st, w) {
    const itab = this.readPath(st[1].v);
    let desc = w[2] === 'DESCENDING';
    const bi = w.indexOf('BY');
    const keys = [];
    if (bi >= 0) {
      for (let k = bi + 1; k < st.length; k++) {
        const u = w[k];
        if (u === 'ASCENDING' || u === 'DESCENDING') { if (keys.length) keys[keys.length - 1].desc = u === 'DESCENDING'; continue; }
        if (u === 'AS' && w[k + 1] === 'TEXT') { k++; continue; }
        // a dynamic component: (name) is a field holding the component's name, or a table of type abap_sortorder_tab
        if (st[k].v === '(') {
          let e = k + 1, depth = 1;
          while (e < st.length && depth) { if (st[e].v === '(') depth++; else if (st[e].v === ')') depth--; if (depth) e++; }
          keys.push({ dyn: new Expr(st.slice(k + 1, e), this).value().js, desc });
          k = e;
          continue;
        }
        if (/^\(.+\)$/.test(st[k].v)) { keys.push({ dyn: new Expr([{ ...st[k], v: st[k].v.slice(1, -1) }], this).value().js, desc }); continue; }
        keys.push({ c: st[k].v.toLowerCase(), desc });
      }
    }
    return `$rt.sort(${itab}, [${keys.map(k => (k.dyn ? `{ dyn: ${k.dyn}, desc: ${k.desc} }` : JSON.stringify(k))).join(', ')}], ${desc});`;
  }

  readTable(st, w) {
    // READ TABLE itab [INTO wa | ASSIGNING <fs> | REFERENCE INTO r | TRANSPORTING NO FIELDS] (WITH [TABLE] KEY ... | INDEX n) [BINARY SEARCH]
    const unassign = st.some((t, q) => isKw(t, 'ELSE') && isKw(st[q + 1], 'UNASSIGN'));
    const parts = splitByKeywords(st.slice(2).filter((t, q, a) => !isKw(t, 'CASTING') && !(isKw(t, 'ELSE') && isKw(a[q + 1], 'UNASSIGN')) && !(isKw(t, 'UNASSIGN') && isKw(a[q - 1], 'ELSE'))), ['INTO', 'ASSIGNING', 'REFERENCE', 'TRANSPORTING', 'WITH', 'INDEX', 'BINARY', 'COMPARING', 'WHERE']);
    const fi = parts[''].findIndex(t => isKw(t, 'FROM'));
    const itab = new Expr(fi > 0 ? parts[''].slice(0, fi) : parts[''], this).value().js;
    const fromWa = fi > 0 ? new Expr(parts[''].slice(fi + 1), this).value().js : null;
    const t = this.t();
    let find;
    if (parts.INDEX) find = `$rt.n(${new Expr(parts.INDEX, this).value().js}) - 1`;
    else if (parts.WITH) {
      let toks = parts.WITH;
      while (isKw(toks[0], 'TABLE', 'KEY')) toks = toks.slice(1);
      if (isKw(toks[1], 'COMPONENTS')) toks = toks.slice(2);
      const comps = pairs(toks, this);
      find = `${t}a.findIndex((r) => ${comps.map(([c, v]) => `$rt.eq(${rowComp('r', c)}, ${v})`).join(' && ') || 'true'})`;
    } else if (parts.WHERE) {
      find = `${t}a.findIndex((${t}w) => ${this.rowCond(parts.WHERE, `${t}w`, st)})`;
    } else if (fromWa) {
      // READ TABLE itab FROM wa: the components of wa form the key
      find = `${t}a.findIndex((r) => Object.entries(${fromWa}).every(([k, v]) => $rt.eq(r?.[k], v)))`;
    } else this.err('READ TABLE needs WITH KEY or INDEX', st);
    let bind = '';
    if (parts.INTO) bind = this.assign(this.target(parts.INTO, st), `$rt.clone(${t}a[${t}])`, false);
    if (parts.ASSIGNING) bind = `${this.target(parts.ASSIGNING, st).js} = ${t}a[${t}];`;
    if (parts.REFERENCE) bind = `${this.target(parts.REFERENCE.slice(1), st).js} = $rt.rowRef(${t}a, ${t});`;
    const unbind = unassign && parts.ASSIGNING ? `${this.target(parts.ASSIGNING, st).js} = undefined;` : '';
    return `{ const ${t}a = ${itab}; const ${t} = ${find}; if (${t} >= 0 && ${t} < ${t}a.length) { $rt.sy.subrc = 0; $rt.sy.tabix = ${t} + 1; ${bind} } else { $rt.sy.subrc = 4; $rt.sy.tabix = 0; ${unbind} } }`;
  }

  concatenate(st, w) {
    const ii = w.indexOf('INTO');
    const sepI = w.indexOf('SEPARATED');
    const linesOf = w[1] === 'LINES' && w[2] === 'OF';
    const srcToks = st.slice(linesOf ? 3 : 1, ii);
    const tgtToks = st.slice(ii + 1, sepI < 0 ? (w.includes('RESPECTING') ? w.indexOf('RESPECTING') : undefined) : sepI);
    const tgt = this.target(tgtToks, st);
    // an inline target of CONCATENATE is a string
    if (isKw(tgtToks[0], 'DATA', 'FINAL') && tgtToks[1]?.v === '(') this.varTypes.set(String(tgtToks[2].v).toLowerCase(), [{ t: 'id', v: 'string' }]);
    const sep = sepI >= 0 ? new Expr(st.slice(sepI + 2).filter(t => !isKw(t, 'RESPECTING', 'BLANKS')), this).value().js : "''";
    if (linesOf) return this.assign(tgt, `${new Expr(srcToks, this).value().js}.map($rt.s).join($rt.s(${sep}))`, false);
    const ex = new Expr(srcToks, this);
    const vals = [];
    while (!ex.done()) vals.push(`$rt.s(${ex.value().js})${w.includes('RESPECTING') ? '' : '.trimEnd()'}`);
    return this.assign(tgt, `[${vals.join(', ')}].join($rt.s(${sep}))`, false);
  }

  replaceStmt(st, w, sectionArg = null) {
    if (w[1] === 'SECTION') {
      const oi = w.indexOf('OFFSET'), li = w.indexOf('LENGTH'), of = w.indexOf('OF'), wi = w.indexOf('WITH');
      const off = oi > 0 ? new Expr(st.slice(oi + 1, li > 0 ? li : of), this).value().js : '0';
      const len = li > 0 ? new Expr(st.slice(li + 1, of), this).value().js : 'undefined';
      const tgt = this.target(st.slice(of + 1, wi), st);
      return this.assign(tgt, `$rt.overlay(${tgt.read}, ${off}, ${len}, ${new Expr(st.slice(wi + 1), this).value().js})`, false);
    }
    // REPLACE [ALL OCCURRENCES OF] a IN b WITH c [IGNORING CASE]
    let k = 1;
    let all = false;
    if (w[1] === 'ALL') { all = true; k = 4; } else if (w[1] === 'FIRST') k = 4;
    let regex = false;
    if (w[k] === 'REGEX' || w[k] === 'PCRE') { regex = true; k++; }
    if (w[k] === 'SUBSTRING') k++;
    const ini = w.indexOf('IN', k);
    const wi = w.indexOf('WITH', ini);
    const what = new Expr(st.slice(k, ini), this).value().js;
    const inTable = w[ini + 1] === 'TABLE';
    let tgtEnd = wi, range = null, section = null;
    if (inTable) { const fi = w.indexOf('FROM', ini), toI = w.indexOf('TO', ini); const ends = [fi, toI].filter(x => x > ini && x < wi); if (ends.length) { tgtEnd = Math.min(...ends); range = { from: fi > ini && fi < wi ? new Expr(st.slice(fi + 1, toI > fi && toI < wi ? toI : wi), this).value().js : '1', to: toI > ini && toI < wi ? new Expr(st.slice(toI + 1, wi), this).value().js : 'Infinity' }; } }
    if (w[ini + 1] === 'SECTION') {
      const of = w.indexOf('OF', ini + 2), oi = w.indexOf('OFFSET', ini), li = w.indexOf('LENGTH', ini);
      section = { off: oi > 0 && oi < of ? new Expr(st.slice(oi + 1, li > 0 && li < of ? li : of), this).value().js : '0', len: li > 0 && li < of ? new Expr(st.slice(li + 1, of), this).value().js : 'undefined' };
      st = [...st.slice(0, ini + 1), ...st.slice(of + 1)];
      w = st.map(t => (t.t === 'id' ? t.v.toUpperCase() : t.v));
      return this.replaceStmt(st, w, section);
    }
    const tgt = this.target(st.slice(ini + 1 + (inTable ? 1 : 0), tgtEnd), st);
    let end = wi + 1;
    while (end < st.length && !['IGNORING', 'RESPECTING', 'REPLACEMENT', 'RESULTS'].includes(w[end])) end++;
    const by = new Expr(st.slice(wi + 1, end), this).value().js;
    const ic = w.includes('IGNORING');
    if (inTable) return `${this.tabRef(tgt)}.forEach((r, i, a) => { if (${range ? `i + 1 < $rt.n(${range.from}) || i + 1 > ${range.to === 'Infinity' ? 'Infinity' : `$rt.n(${range.to})`}` : 'false'}) return; a[i] = typeof r === 'object' && r !== null ? r : $rt.replace(r, ${what}, ${by}, ${all}, ${regex}, ${ic}); }); $rt.sy.subrc = 0;`;
    if (sectionArg) return this.assign(tgt, `((s, o, l) => s.slice(0, o) + $rt.replace(s.substr(o, l ?? s.length), ${what}, ${by}, ${all}, ${regex}, ${ic}) + s.slice(o + (l ?? s.length)))($rt.s(${tgt.read}), $rt.n(${sectionArg.off}), ${sectionArg.len === 'undefined' ? 'undefined' : `$rt.n(${sectionArg.len})`})`, false);
    return this.assign(tgt, `$rt.replace(${tgt.read}, ${what}, ${by}, ${all}, ${regex}, ${ic})`, false);
  }

  splitStmt(st, w) {
    const ai = w.indexOf('AT');
    const ii = w.indexOf('INTO');
    const src = new Expr(st.slice(1, ai), this).value().js;
    const sep = new Expr(st.slice(ai + 1, ii), this).value().js;
    if (w[ii + 1] === 'TABLE') {
      const tgt = this.target(st.slice(ii + 2), st);
      return this.assign(tgt, `$rt.splitAt(${src}, ${sep})`, false);
    }
    const tgts = this.targetList(st.slice(ii + 1), st);
    const t = this.t();
    return `{ const ${t} = $rt.splitAt(${src}, ${sep}); ${tgts.map((g, n) => this.assign(g, n === tgts.length - 1 ? `${t}.slice(${n}).join($rt.sepOf(${sep}))` : `${t}[${n}] ?? ''`, false)).join(' ')} }`;
  }

  assignStmt(st, w) {
    // ASSIGN itab[ ... ] TO <fs> | ASSIGN struct TO <fs> | ASSIGN COMPONENT x OF STRUCTURE s TO <fs>
    // ELSE UNASSIGN: the field symbol is unassigned when the assignment fails
    if (w.at(-2) === 'ELSE' && w.at(-1) === 'UNASSIGN') {
      const code = this.assignStmt(st.slice(0, -2), w.slice(0, -2));
      const fs = this.target(st.slice(w.lastIndexOf('TO') + 1, -2), st);
      return `${code} if ($rt.sy.subrc !== 0) ${fs.js} = undefined;`;
    }
    const ti = w.lastIndexOf('TO');
    const ci = w.indexOf('CASTING', ti);
    const fs = this.target(st.slice(ti + 1, ci < 0 ? undefined : ci), st);
    if (w[1] === 'COMPONENT') {
      const oi = w.indexOf('OF');
      const comp = new Expr(st.slice(2, oi), this).value().js;
      const s = new Expr(st.slice(oi + 2, ti), this).value().js;
      return `{ const $s = ${s}, $c = $rt.s(${comp}).toLowerCase(); if ($s && $c in $s) { ${fs.js} = $s[$c]; $rt.sy.subrc = 0; } else $rt.sy.subrc = 4; }`;
    }
    const src = st.slice(1, ti);
    // ASSIGN (name) TO <fs>: a data object named at runtime ('LV_X', 'LS_S-COMP', 'ME->ATTR', 'ZCL_X=>ATTR')
    if (src[0]?.v === '(' && src.at(-1)?.v === ')' && src.slice(1, -1).every(t => t.v !== '(' || t.ws === false)) {
      const name = new Expr(src.slice(1, -1), this).value().js;
      return `{ const $d = $rt.dynRef(${this.dynScopeJs()}, this, ${name}); if ($d) { ${fs.js} = $d.get(); $rt.sy.subrc = 0; } else $rt.sy.subrc = 4; }`;
    }
    const ex = new Expr(src, this);
    ex.optional = true;
    const v = ex.value().js;
    return `{ const $v = ${v}; if ($v !== undefined) { ${fs.js} = $v; $rt.sy.subrc = 0; } else $rt.sy.subrc = 4; }`;
  }

  // ---- method call statement ------------------------------------------------------------
  callStatement(toks, st, callMethod) {
    // obj->meth( [EXPORTING ...] [IMPORTING ...] [CHANGING ...] [RECEIVING ...] )
    // CALL METHOD (clsname)=>meth / (clsname)=>(meth): a class given at runtime
    if (callMethod && toks[0].t === 'p' && toks[0].v === '(') {
      const close = toks.findIndex(t => t.t === 'p' && t.v === ')');
      if (toks[close + 1]?.v === '=>') {
        const clsJs = `$rt.cls($rt.s(${new Expr(toks.slice(1, close), this).value().js}).toLowerCase())`;
        const tmp = `zz_dyncls_${++this.tmp}`;
        const js = this.declare(tmp);
        return `${js} = ${clsJs}; ${this.callStatement([{ t: 'id', v: tmp, line: toks[0].line }, { t: 'p', v: '-' }, { t: 'p', v: '>' }, ...(toks[close + 2]?.v === '(' ? toks.slice(close + 2) : [{ t: 'p', v: '(' }, { t: 'char', v: toks[close + 2].v }, { t: 'p', v: ')' }, ...toks.slice(close + 3)])], st, true)}`;
      }
    }
    if (callMethod && toks[0].t === 'id' && toks[1]?.v === '=>' && toks[2]?.v === '(') toks = [{ ...toks[0], v: `$cls$${toks[0].v}` }, { t: 'p', v: '-' }, { t: 'p', v: '>' }, ...toks.slice(2)];
    if (callMethod && toks[0].t === 'p' && toks[0].v === '(' || callMethod && toks[0].t === 'id' && toks[1]?.v === '-' && toks[2]?.v === '>' && toks[3]?.v === '(') {
      // dynamic: CALL METHOD (name) | obj->(name) | cls=>(name)  [EXPORTING ... IMPORTING ... RECEIVING ...]
      let objJs = 'this', k = 0;
      if (toks[0].t === 'id') { objJs = toks[0].v.startsWith('$cls$') ? `$rt.cls(${Q(toks[0].v.slice(5).toLowerCase())})` : this.readPath(toks[0].v); k = 3; }
      let depth = 0, j = k;
      for (; j < toks.length; j++) { if (toks[j].v === '(') depth++; if (toks[j].v === ')') { depth--; if (!depth) break; } }
      const nameJs = new Expr(toks.slice(k + 1, j), this).value().js;
      const rest = toks.slice(j + 1);
      const pt = rest.findIndex(t => isKw(t, 'PARAMETER-TABLE'));
      if (pt >= 0) {
        let e = pt + 1;
        while (e < rest.length && !isKw(rest[e], 'EXCEPTION-TABLE')) e++;
        return `$rt.callDynamic(${objJs}, $rt.s(${nameJs}).toLowerCase(), ${new Expr(rest.slice(pt + 1, e), this).value().js});`;
      }
      const ex = new Expr([{ t: 'p', v: '(', ws: false }, ...rest, { t: 'p', v: ')', ws: true }], this);
      ex.next();
      const args = ex.callArgs();
      const r = this.t();
      return `{ const ${r} = $rt.call(${objJs}, $rt.s(${nameJs}).toLowerCase(), ${args.js}); ${args.back.map(([n, tk]) => this.assign(this.target(tk, st), `${r}${prop(n)}`, false)).join(' ')} }`;
    }
    if (callMethod) {
      // CALL METHOD obj->meth EXPORTING ... (without parentheses)
      if (!(toks[1]?.v === '(' && !toks[1].ws)) {
        const name = toks[0];
        const inner = toks.slice(1);
        toks = [name, { t: 'p', v: '(', ws: false, line: name.line }, ...inner, { t: 'p', v: ')', ws: true, line: name.line }];
      }
    }
    const ex = new Expr(toks, this);
    const js = ex.callStatement();
    if (!ex.done()) this.err(`Unexpected '${ex.peek().v}' after method call`, st);
    return js;
  }

  // NEW zcl( )->meth( EXPORTING ... IMPORTING ... ) as a statement
  newCallStatement(st) {
    let sel = -1, depth = 0;
    for (let k = 0; k < st.length; k++) {
      const t = st[k];
      if (t.t === 'p' && (t.v === '(' || t.v === '[')) depth++;
      if (t.t === 'p' && (t.v === ')' || t.v === ']')) depth--;
      if (!depth && t.t === 'sel' && st[k + 1]?.v === '(' && !st[k + 1].ws) sel = k;
    }
    if (sel < 0) { const v = new Expr(st, this).value(); return `${v.js};`; }
    const obj = new Expr(st.slice(0, sel), this).value().js;
    const segs = splitPath('x' + st[sel].v).slice(1);
    let objJs = obj;
    for (const sg of segs.slice(0, -1)) objJs = applySeg(objJs, sg);
    const name = segs[segs.length - 1].name.toLowerCase();
    const ex = new Expr(st.slice(sel + 1), this);
    ex.expectP('(');
    const args = ex.callArgs();
    ex.expectP(')');
    const r = this.t();
    return `{ const ${r} = $rt.call(${objJs}, ${Q(name)}, ${args.js}); ${args.back.map(([n, tk]) => this.assign(this.target(tk, st), `${r}${prop(n)}`, false)).join(' ')} }`;
  }

  findStmt(st, w) {
    // FIND [FIRST OCCURRENCE OF | ALL OCCURRENCES OF] [SUBSTRING | REGEX | PCRE] pattern IN text
    //      [IGNORING CASE | RESPECTING CASE] [MATCH COUNT c] [MATCH OFFSET o] [MATCH LENGTH l] [RESULTS r] [SUBMATCHES s1 ...]
    let k = 1, all = false, regex = false;
    if (w[1] === 'ALL') { all = true; k = 4; } else if (w[1] === 'FIRST') k = 4;
    if (w[k] === 'SUBSTRING') k++;
    else if (w[k] === 'REGEX' || w[k] === 'PCRE') { regex = true; k++; }
    const ini = w.indexOf('IN', k);
    const pattern = new Expr(st.slice(k, ini), this).value().js;
    const inTable = w[ini + 1] === 'TABLE';
    const opts = ['IGNORING', 'RESPECTING', 'MATCH', 'RESULTS', 'SUBMATCHES'];
    // IN SECTION [OFFSET o] [LENGTH l] OF text: search a substring, offsets stay relative to text
    let secOff = '0', secLen = 'undefined', from = ini + 1 + (inTable ? 1 : 0);
    if (w[ini + 1] === 'SECTION') {
      const of = w.indexOf('OF', ini + 2);
      const oi = w.indexOf('OFFSET', ini), li = w.indexOf('LENGTH', ini);
      if (oi > 0 && oi < of) secOff = new Expr(st.slice(oi + 1, li > 0 && li < of ? li : of), this).value().js;
      if (li > 0 && li < of) secLen = new Expr(st.slice(li + 1, of), this).value().js;
      from = of + 1;
    }
    let e = from;
    while (e < st.length && !opts.includes(w[e])) e++;
    const whole = new Expr(st.slice(from, e), this).value().js;
    const text = w[ini + 1] === 'SECTION' ? `' '.repeat($rt.n(${secOff})) + $rt.s(${whole}).substr($rt.n(${secOff}), ${secLen})` : whole;
    const ignoreCase = w.includes('IGNORING');
    const r = this.t();
    const out = [];
    for (let q = e; q < st.length; q++) {
      if (w[q] === 'MATCH') { const what = w[q + 1].toLowerCase(); out.push(this.assign(this.target([st[q + 2]].concat(st[q + 3]?.v === '(' && !st[q + 3].ws ? st.slice(q + 3, q + 6) : []), st), `${r}.${what}`, false)); q += 2; }
      else if (w[q] === 'RESULTS') { const tk = [st[q + 1]].concat(st[q + 2]?.v === '(' && !st[q + 2].ws ? st.slice(q + 2, q + 5) : []); out.push(this.assign(this.target(tk, st), all ? `${r}.results` : `${r}.results[0] ?? {}`, false)); q += tk.length; }
      else if (w[q] === 'SUBMATCHES') { let q2 = q + 1; while (q2 < st.length && !opts.includes(w[q2])) q2++; this.targetList(st.slice(q + 1, q2), st).forEach((g, n) => out.push(this.assign(g, `${r}.sub[${n}] ?? ''`, false))); q = q2 - 1; }
    }
    return `{ const ${r} = $rt.${inTable ? 'findInTable' : 'find'}(${text}, ${pattern}, ${all}, ${regex}, ${ignoreCase}); ${out.join(' ')} }`;
  }

  // CALL FUNCTION name [DESTINATION d] [IN UPDATE TASK | IN BACKGROUND TASK | STARTING NEW TASK t]
  //   [EXPORTING p = a ...] [IMPORTING p = b ...] [CHANGING p = c ...] [TABLES p = itab ...] [EXCEPTIONS e = n ... OTHERS = n]
  // Update and background tasks run at COMMIT WORK with the values of now; a new task runs at once.
  callFunction(st, w) {
    const nameJs = new Expr([st[2]], this).value().js;
    const sections = ['EXPORTING', 'IMPORTING', 'CHANGING', 'TABLES', 'EXCEPTIONS'];
    let k = 3;
    const update = w.slice(3).some((x, q) => x === 'IN' && (w[3 + q + 1] === 'UPDATE' || w[3 + q + 1] === 'BACKGROUND'));
    while (k < st.length && !sections.includes(w[k])) k++;
    const rest = st.slice(k).map((t, q) => (isKw(t, 'TABLES') ? { ...t, v: 'CHANGING' } : t));
    const ex = new Expr([{ t: 'p', v: '(', ws: false }, ...rest, { t: 'p', v: ')', ws: true }], this);
    ex.next();
    const args = ex.callArgs();
    if (update) return `{ const $a = $rt.clone(${args.js}); $rt.onCommit(() => $rt.callFunction(${nameJs}, $a)); }`;
    const r = this.t();
    const call = `const ${r} = $rt.callFunction(${nameJs}, ${args.js}); ${args.back.map(([n, tk]) => this.assign(this.target(tk, st), `${r}${prop(n)}`, false)).join(' ')}`;
    return args.exceptions?.length
      ? `try { ${call} $rt.sy.subrc = 0; } catch ($e) { const $n = $rt.classicSubrc($e, { ${args.exceptions.map(([n, v]) => `${Q(n)}: ${v}`).join(', ')} }); if ($n === null) throw $e; $rt.sy.subrc = $n; }`
      : `{ ${call} }`;
  }

  // OPEN CURSOR [WITH HOLD] @c FOR SELECT ...: the result is read in packages with FETCH
  openCursor(st, w) {
    const fi = w.indexOf('FOR');
    const ctoks = st.slice(2, fi).filter(t => !(t.t === 'p' && t.v === '@') && !isKw(t, 'WITH', 'HOLD'));
    const tmp = `zz_cursor_${++this.tmp}`;
    this.declare(tmp);
    const at = { t: 'p', v: '@', line: st[0].line };
    const sel = new SqlBuilder(this).select([...st.slice(fi + 1), { t: 'id', v: 'INTO' }, { t: 'id', v: 'TABLE' }, at, { t: 'id', v: tmp, line: st[0].line }]);
    return `${sel} ${this.assign(this.target(ctoks, st), `$rt.openCursor(${jsVar(tmp)})`, false)}`;
  }
  // FETCH NEXT CURSOR @c INTO|APPENDING [CORRESPONDING FIELDS OF] TABLE @itab [PACKAGE SIZE n] | INTO @wa
  fetchCursor(st, w) {
    const ci = w.indexOf('CURSOR');
    const ii = w.findIndex(x => x === 'INTO' || x === 'APPENDING');
    const cur = new Expr(st.slice(ci + 1, ii).filter(t => !(t.t === 'p' && t.v === '@')), this).value().js;
    const append = w[ii] === 'APPENDING';
    const isTable = w.slice(ii).includes('TABLE');
    const pi = w.indexOf('PACKAGE');
    const size = pi > 0 ? new Expr(st.slice(pi + 2), this).value().js : (isTable ? '0' : '1');
    const tgtToks = st.slice(ii + 1, pi > 0 ? pi : undefined).filter(t => !(t.t === 'p' && t.v === '@') && !isKw(t, 'CORRESPONDING', 'FIELDS', 'OF', 'TABLE'));
    const tgt = this.target(tgtToks, st);
    const t = this.t();
    if (!isTable) return `{ const ${t} = $rt.fetchCursor(${cur}, 1); if (${t}.length) ${this.assign(tgt, `$rt.clone(${t}[0])`, false)} }`;
    return `{ const ${t} = $rt.fetchCursor(${cur}, $rt.n(${size})); if (${t}.length || !${append}) ${this.assign(tgt, append ? `[...${tgt.read}, ...${t}]` : t, false)} }`;
  }
  // files on the application server, in the app's folder .rap/files: OPEN DATASET f FOR INPUT|OUTPUT|APPENDING
  // IN TEXT MODE ENCODING ... | IN BINARY MODE, TRANSFER x TO f, READ DATASET f INTO x, CLOSE DATASET f, DELETE DATASET f
  dataset(st, w) {
    if (w[0] === 'TRANSFER') { const ti = w.lastIndexOf('TO'); return `$rt.datasetWrite(${new Expr(st.slice(ti + 1), this).value().js}, ${new Expr(st.slice(1, ti), this).value().js}, ${w.includes('NO') && w.includes('END') ? 'true' : 'false'});`; }
    if (w[0] === 'CLOSE') return `$rt.datasetClose(${new Expr(st.slice(2), this).value().js});`;
    const fi = w.indexOf('FOR');
    const file = new Expr(st.slice(2, fi), this).value().js;
    const mode = w[fi + 1].toLowerCase();
    const binary = w.includes('BINARY');
    return `$rt.datasetOpen(${file}, ${Q(mode)}, ${binary});`;
  }

  // SUBMIT rep|(name) [WITH p = v | WITH s IN rtab | WITH s BETWEEN a AND b | WITH SELECTION-TABLE rspar]
  //   [USING SELECTION-SET var] [VIA SELECTION-SCREEN] [EXPORTING LIST TO MEMORY] [AND RETURN]
  // The report runs on the classic engine; with EXPORTING LIST TO MEMORY its list is read with LIST_FROM_MEMORY.
  submitStmt(st, w) {
    const close = st.findIndex(t => t.v === ')');
    const nameJs = st[1].v === '(' ? new Expr(st.slice(2, close), this).value().js : Q(String(st[1].v).toUpperCase());
    const STOP = ['WITH', 'EXPORTING', 'VIA', 'USING', 'TO', 'SIGN'];
    const stop = k => isKw(st[k], ...STOP) || (isKw(st[k], 'AND') && isKw(st[k + 1], 'RETURN'));
    const parts = [];
    let sel = 'null';
    for (let k = 2; k < st.length; k++) {
      if (!isKw(st[k], 'WITH')) continue;
      if (isKw(st[k + 1], 'SELECTION-TABLE')) { sel = new Expr([st[k + 2]], this).value().js; k += 2; continue; }
      const p = String(st[k + 1].v).toUpperCase(), op = String(st[k + 2]?.v).toUpperCase();
      let e = k + 3;
      if (op === 'BETWEEN') {
        while (e < st.length && !isKw(st[e], 'AND')) e++;
        let f = e + 1;
        while (f < st.length && !stop(f)) f++;
        parts.push(`$v[${Q(`${p}-LOW`)}] = $rt.s(${new Expr(st.slice(k + 3, e), this).value().js}); $v[${Q(`${p}-HIGH`)}] = $rt.s(${new Expr(st.slice(e + 1, f), this).value().js});`);
        k = f - 1; continue;
      }
      while (e < st.length && !stop(e)) e++;
      const v = new Expr(st.slice(k + 3, e), this).value().js;
      parts.push(op === 'IN'
        ? `{ const $r = (${v})?.[0]; if ($r) { $v[${Q(`${p}-LOW`)}] = $rt.s($r.low); if ($rt.s($r.high).trim()) $v[${Q(`${p}-HIGH`)}] = $rt.s($r.high); } }`
        : `$v[${Q(p)}] = $rt.s(${v});`);
      k = e - 1;
    }
    const toMemory = w.includes('LIST') && w.includes('MEMORY');
    return `$rt.submit(${nameJs}, (() => { const $v = {}; ${parts.join(' ')} return $v; })(), ${sel}, ${toMemory});`;
  }
  // CALL TRANSACTION tc [WITH|WITHOUT AUTHORITY-CHECK] USING bdc_tab [MODE m] [UPDATE u] [MESSAGES INTO msgs]:
  // batch input on the classic engine (screens with their fields and function codes); without USING it needs a user
  callTransactionStmt(st, w) {
    const tc = new Expr([st[2]], this).value().js;
    const ui = w.indexOf('USING');
    if (ui < 0) return `throw $rt.new('cx_sy_dyn_call_illegal_func', { text: 'CALL TRANSACTION ' + $rt.s(${tc}) + ' without USING needs a user: start it in the preview (Classic ABAP programs)' });`;
    const end = w.findIndex((x, q) => q > ui && ['MODE', 'UPDATE', 'MESSAGES', 'AND', 'OPTIONS'].includes(x));
    const bdc = new Expr(st.slice(ui + 1, end < 0 ? undefined : end), this).value().js;
    const mi = w.indexOf('MESSAGES');
    const t = this.t();
    return `{ const ${t} = $rt.callTransaction(${tc}, ${bdc}); ${mi > 0 ? this.assign(this.target(st.slice(mi + 2), st), t, false) : ''} }`;
  }

  // PERFORM form [TABLES t ...] [USING a ...] [CHANGING c ...] [ON COMMIT]: a FORM routine of the function group
  // (a method of the group's class); the actual parameters go to the formal ones by position
  perform(st, w) {
    const name = String(st[1].v).toLowerCase();
    const onCommit = w.includes('ON') && w.includes('COMMIT');
    const toks = st.slice(2).filter((t, q, a) => !(isKw(t, 'ON') && isKw(a[q + 1], 'COMMIT')) && !(isKw(t, 'COMMIT') && isKw(a[q - 1], 'ON')) && !isKw(t, 'TABLES', 'USING', 'CHANGING'));
    let sig = null;
    for (let d = this.cls.def; d && !sig; d = d.superName ? this.cls.defs.get(d.superName) : null) sig = d.methods.get(name);
    if (!sig) this.err(`FORM ${name.toUpperCase()} not found (FORM routines are supported in function groups)`, st);
    const formal = [...(sig.importing || []), ...(sig.changing || []), ...(sig.exporting || [])].map(p => p.name);
    const call = [{ t: 'id', v: name, line: st[0].line }, { t: 'p', v: '(', ws: false }];
    if (toks.length) call.push({ t: 'id', v: 'CHANGING' });
    toks.forEach((t, q) => { call.push({ t: 'id', v: formal[q] ?? `p${q}` }, { t: 'p', v: '=', ws: true }, t); });
    call.push({ t: 'p', v: ')', ws: true });
    const code = this.callStatement(call, st, false);
    return onCommit ? `$rt.onCommit(() => { ${code} });` : code;
  }

  // EXPORT p1 = dobj1 p2 FROM dobj2 ... | (ptab) TO MEMORY ID id | DATA BUFFER xstr | INTERNAL TABLE itab |
  //   DATABASE dbtab(ar) ID id | SHARED MEMORY / BUFFER dbtab(ar) ID id
  // IMPORT p1 = dobj1 p2 TO dobj2 ... | (ptab) FROM ... (the same media); sy-subrc 4 when nothing was exported there
  exportImport(st, w) {
    const imp = w[0] === 'IMPORT';
    const mi = w.findIndex((x, k) => k > 0 && x === (imp ? 'FROM' : 'TO') && ['MEMORY', 'DATA', 'INTERNAL', 'DATABASE', 'SHARED'].includes(w[k + 1]));
    if (mi < 0) this.err(`${w[0]}: TO/FROM MEMORY, DATA BUFFER, INTERNAL TABLE or DATABASE expected`, st);
    const medium = w[mi + 1];
    let k = mi + (medium === 'DATA' || medium === 'INTERNAL' || medium === 'SHARED' ? 3 : 2);
    const rest = st.slice(k);
    const rw = w.slice(k);
    let where;
    if (medium === 'MEMORY') where = `{ kind: 'memory', id: $rt.s(${new Expr(rest.slice(rw.indexOf('ID') + 1), this).value().js}) }`;
    else if (medium === 'DATA' || medium === 'INTERNAL') where = `{ kind: ${Q(medium === 'DATA' ? 'buffer' : 'itab')}, ref: $rt.ref(() => ${this.target(rest.slice(0, 1), st).read}, ($v) => { ${this.assign(this.target(rest.slice(0, 1), st), '$v', false)} }) }`;
    else {   // DATABASE / SHARED BUFFER dbtab(ar) [FROM wa | TO wa] [CLIENT c] ID id
      const tab = String(rest[0].v).toLowerCase(), area = rest[1]?.v === '(' ? String(rest[2].v).toUpperCase() : '';
      where = `{ kind: 'database', table: ${Q(tab)}, area: ${Q(area)}, id: $rt.s(${new Expr(rest.slice(rw.indexOf('ID') + 1), this).value().js}) }`;
    }
    const list = st.slice(1, mi);
    const scope = this.dynScopeJs();
    // (ptab): a table of name / value (dobj name as text)
    if (list[0]?.v === '(') return `$rt.${imp ? 'importDyn' : 'exportDyn'}(${new Expr(list.slice(1, -1), this).value().js}, ${where}, ${scope}, this);`;
    const params = [];
    for (let q = 0; q < list.length;) {
      const name = String(list[q].v).toLowerCase();
      if (list[q + 1] && (list[q + 1].v === '=' || isKw(list[q + 1], imp ? 'TO' : 'FROM'))) { params.push([name, list[q + 2]]); q += 3; }
      else { params.push([name, list[q]]); q += 1; }
    }
    if (!imp) return `$rt.exportData({ ${params.map(([n, t]) => `${Q(n)}: $rt.clone(${new Expr([t], this).value().js})`).join(', ')} }, ${where});`;
    const tmp = this.t();
    return `{ const ${tmp} = $rt.importData(${where}); if (${tmp}) { ${params.map(([n, t]) => { const tg = this.target([t], st); return `if (${Q(n)} in ${tmp}) ${this.assign(tg, `$rt.clone(${tmp}[${Q(n)}])`, false)}`; }).join(' ')} $rt.sy.subrc = 0; } else $rt.sy.subrc = 4; }`;
  }

  // CALL TRANSFORMATION id SOURCE n1 = e1 ... | SOURCE XML x  RESULT XML r | RESULT n1 = t1 ...
  // Only the identity transformation (asXML, or JSON when the result is a JSON writer) is available.
  callTransformation(st, w) {
    const name = st[2].v.toLowerCase();
    const si = w.indexOf('SOURCE'), ri = w.indexOf('RESULT');
    const end = (k) => { let e = k; while (e < st.length && !['RESULT', 'OPTIONS', 'PARAMETERS'].includes(w[e])) e++; return e; };
    const pairs = (from, to) => {
      const out = [];
      for (let k = from; k < to;) {
        const n = st[k].v.toLowerCase();
        let e = k + 2;
        while (e < to && !(st[e].t === 'id' && st[e + 1]?.v === '=' && st[e + 1]?.ws !== false && e > k + 2)) e++;
        out.push([n, st.slice(k + 2, e)]);
        k = e;
      }
      return out;
    };
    let src;
    if (st[si + 1]?.v === '(') src = `{ values: Object.fromEntries((${new Expr(st.slice(si + 2, st.findIndex((t, q) => q > si + 1 && t.v === ')')), this).value().js}).map(r => [$rt.s(r.name).toLowerCase(), $rt.deref(r.value)])) }`;
    else if (w[si + 1] === 'XML' || w[si + 1] === 'JSON') src = `{ xml: ${new Expr(st.slice(si + 2, end(si + 2)), this).value().js} }`;   // JSON text is recognised by its content
    else src = `{ values: { ${pairs(si + 1, end(si + 1)).map(([n, t]) => `${Q(n)}: ${new Expr(t, this).value().js}`).join(', ')} } }`;
    const t = this.t();
    let re = ri + 1;
    while (re < st.length && !['OPTIONS', 'PARAMETERS'].includes(w[re])) re++;
    let assign;
    if (st[ri + 1]?.v === '(') {
      const tab = new Expr(st.slice(ri + 2, st.findIndex((x, q) => q > ri + 1 && x.v === ')')), this).value().js;
      assign = `for (const r of ${tab}) { const v = ${t}.values?.[$rt.s(r.name).toLowerCase()]; if (v !== undefined) $rt.setDeref(r.value, v); }`;
      return `{ const ${t} = $rt.transformation(${Q(name)}, ${src}, {}); ${assign} }`;
    }
    if (w[ri + 1] === 'JSON') {
      const tg = this.target(st.slice(ri + 2, re), st);
      return `{ const ${t}w = $rt.cls('cl_sxml_string_writer').create({ type: 'json' }).$ret; $rt.transformation(${Q(name)}, ${src}, { xml: true, target: ${t}w }); ${this.assign(tg, `${t}w.output`, false)} }`;
    }
    if (w[ri + 1] === 'XML') assign = this.assign(this.target(st.slice(ri + 2, re), st), `${t}.xml`, false);
    else assign = pairs(ri + 1, re).map(([n, tk]) => this.assign(this.target(tk, st), `${t}.values[${Q(n)}] ?? $rt.initialOf(${this.target(tk, st).read})`, false)).join(' ');
    return `{ const ${t} = $rt.transformation(${Q(name)}, ${src}, ${w[ri + 1] === 'XML' ? `{ xml: true, target: ${this.target(st.slice(ri + 2, re), st).read} }` : '{}'}); ${assign} }`;
  }

  // ---- EML -----------------------------------------------------------------------------------
  emlRead(st, w) {
    // READ ENTITIES OF bo [IN LOCAL MODE] ENTITY e [BY \assoc] (ALL FIELDS | FIELDS ( f... )) WITH x RESULT r [LINK l] ... [FAILED f] [REPORTED r]
    // READ ENTITY [IN LOCAL MODE] e ...
    const p = new EmlParser(st, this);
    p.next(); // READ
    let bo = null;
    if (p.kw('ENTITIES') && isKw(st[2], 'OPERATIONS')) return this.emlDynamic(st, 'read');
    if (p.kw('ENTITIES')) { p.next(); p.expect('OF'); bo = p.next().v.toLowerCase(); }
    else { p.next(); }
    const local = p.localMode();
    const parts = [];
    const after = [];
    const shortForm = !bo;
    while (!p.done()) {
      if (p.kw('ENTITY') || (shortForm && !parts.length)) {
        if (p.kw('ENTITY')) p.next();
        const entity = p.next().v.toLowerCase();
        const part = { entity, assoc: null, fields: null, rows: null, result: null, link: null };
        if (p.kw('BY')) { p.next(); part.assoc = p.next().v.replace(/^\\/, '').toLowerCase(); }
        if (p.kw('ALL')) { p.next(); p.expect('FIELDS'); }
        else if (p.kw('FIELDS')) { p.next(); part.fields = p.fieldList(); }
        if (p.kw('WITH') || p.kw('FROM')) { p.next(); part.rows = p.expr(); }
        while (p.kw('RESULT') || p.kw('LINK')) {
          const k = p.next().v.toUpperCase();
          part[k === 'RESULT' ? 'result' : 'link'] = p.targetToks();
        }
        parts.push(part);
        continue;
      }
      if (p.kw('FAILED') || p.kw('REPORTED')) { const k = p.next().v.toLowerCase(); after.push([k, p.targetToks()]); continue; }
      this.err(`Unexpected '${p.peek().v}' in READ ENTITIES`, st);
    }
    const t = this.t();
    const spec = `{ bo: ${Q(bo)}, local: ${local}, parts: [${parts.map(pt => `{ entity: ${Q(pt.entity)}, assoc: ${Q(pt.assoc)}, fields: ${JSON.stringify(pt.fields)}, rows: ${pt.rows} }`).join(', ')}] }`;
    const assigns = [];
    parts.forEach((pt, n) => {
      if (pt.result) assigns.push(this.assign(this.target(pt.result, st), `${t}.results[${n}]`, false));
      if (pt.link) assigns.push(this.assign(this.target(pt.link, st), `${t}.links[${n}]`, false));
    });
    for (const [k, toks] of after) assigns.push(this.assign(this.target(toks, st), `${t}.${k}`, false));
    return `{ const ${t} = $rt.eml.read(${spec});\n${assigns.join('\n')} }`;
  }

  emlModify(st, w) {
    const p = new EmlParser(st, this);
    p.next(); // MODIFY
    let bo = null;
    if (p.kw('ENTITIES') && isKw(st[2], 'OPERATIONS')) return this.emlDynamic(st, 'modify');
    if (p.kw('ENTITIES')) { p.next(); p.expect('OF'); bo = p.next().v.toLowerCase(); }
    else p.next();
    const local = p.localMode();
    const ops = [];
    const after = [];
    let entity = null;
    const shortForm = !bo;
    if (shortForm) entity = p.next().v.toLowerCase();
    while (!p.done()) {
      if (p.kw('ENTITY')) { p.next(); entity = p.next().v.toLowerCase(); continue; }
      if (p.kw('CREATE') || p.kw('UPDATE') || p.kw('DELETE') || p.kw('EXECUTE')) {
        const kind = p.next().v.toLowerCase();
        const op = { entity, op: kind, assoc: null, action: null, fields: null, rows: null, result: null, autoCid: false };
        if (kind === 'execute') op.action = p.next().v.toLowerCase();
        if (kind === 'create' && p.kw('BY')) { p.next(); op.assoc = p.next().v.replace(/^\\/, '').toLowerCase(); op.op = 'cba'; }
        if (p.kw('AUTO')) { p.next(); p.expect('FILL'); p.expect('CID'); op.autoCid = true; }
        if (p.kw('FIELDS')) { p.next(); op.fields = p.fieldList(); }
        else if (p.kw('SET')) { p.next(); p.expect('FIELDS'); op.fields = 'set'; }
        if (p.kw('WITH') || p.kw('FROM')) { const how = p.next().v.toUpperCase(); if (how === 'FROM' && !op.fields) op.fields = 'control'; op.rows = p.expr(); }
        if (p.kw('RESULT')) { p.next(); op.result = p.targetToks(); }
        ops.push(op);
        continue;
      }
      if (p.kw('MAPPED') || p.kw('FAILED') || p.kw('REPORTED')) { const k = p.next().v.toLowerCase(); after.push([k, p.targetToks()]); continue; }
      if (p.kw('RESULT')) { p.next(); ops[ops.length - 1].result = p.targetToks(); continue; }
      this.err(`Unexpected '${p.peek().v}' in MODIFY ENTITIES`, st);
    }
    const t = this.t();
    const spec = `{ bo: ${Q(bo)}, local: ${local}, ops: [${ops.map(o => `{ entity: ${Q(o.entity)}, op: ${Q(o.op)}, assoc: ${Q(o.assoc)}, action: ${Q(o.action)}, fields: ${JSON.stringify(o.fields)}, autoCid: ${o.autoCid}, rows: ${o.rows} }`).join(', ')}] }`;
    const assigns = [];
    ops.forEach((o, n) => { if (o.result) assigns.push(this.assign(this.target(o.result, st), `${t}.results[${n}]`, false)); });
    for (const [k, toks] of after) assigns.push(this.assign(this.target(toks, st), `${t}.${k}`, false));
    return `{ const ${t} = $rt.eml.modify(${spec});\n${assigns.join('\n')} }`;
  }

  // READ / MODIFY ENTITIES OPERATIONS op_tab [FAILED f] [REPORTED r] [MAPPED m]
  // op_tab rows: op, entity_name, sub_name, instances (REF to rows), results / links (REF to result tables)
  emlDynamic(st, kind) {
    const p = new EmlParser(st, this);
    p.i = 3;
    const ops = p.expr();
    const after = [];
    while (!p.done()) {
      if (p.kw('MAPPED') || p.kw('FAILED') || p.kw('REPORTED')) { const k = p.next().v.toLowerCase(); after.push([k, p.targetToks()]); continue; }
      this.err(`Unexpected '${p.peek().v}' in ${kind.toUpperCase()} ENTITIES OPERATIONS`, st);
    }
    const t = this.t();
    return `{ const ${t} = $rt.eml.dynamic(${Q(kind)}, ${ops});\n${after.map(([k, toks]) => this.assign(this.target(toks, st), `${t}.${k}`, false)).join('\n')} }`;
  }

  emlCommit(st, w) {
    // COMMIT WORK: the SAP LUW's update function modules and ON COMMIT routines run, then the RAP save
    if (w[1] === 'WORK') return `$rt.commitWork(); $rt.eml.commit();`;
    // COMMIT ENTITIES [RESPONSE OF bo FAILED f REPORTED r] | [RESPONSES FAILED f REPORTED r]
    const t = this.t();
    const assigns = [];
    for (let k = 2; k < st.length; k++) {
      if (['FAILED', 'REPORTED', 'MAPPED'].includes(w[k])) {
        const toks = [st[k + 1]];
        if (st[k + 2]?.v === '(' && !st[k + 2].ws) toks.push(st[k + 2], st[k + 3], st[k + 4]);
        assigns.push(this.assign(this.target(toks, st), `${t}.${w[k].toLowerCase()}`, false));
      }
    }
    return `{ const ${t} = $rt.eml.commit();\n${assigns.join('\n')} }`;
  }

  // ---- ABAP SQL ------------------------------------------------------------------------------
  selectStmt(st, w) {
    if (isLoopSelect(st)) this.err('SELECT ... ENDSELECT loops are not supported; use INTO TABLE', st);
    const sq = new SqlBuilder(this);
    return sq.select(st);
  }

  updateDb(st, w) {
    const tab = st[1].v.toLowerCase();
    if (w[2] === 'SET') {
      const wi = w.indexOf('WHERE');
      const sq = new SqlBuilder(this);
      const set = sq.translate(st.slice(3, wi < 0 ? undefined : wi));
      const where = wi >= 0 ? ' WHERE ' + sq.translate(st.slice(wi + 1)) : '';
      return `$rt.sql.exec(${Q(`UPDATE ${sqlIdent(tab)} SET ${set}${where}`)}, ${sq.paramsJs()});`;
    }
    const fi = w.indexOf('FROM');
    const isTable = w[fi + 1] === 'TABLE';
    const v = new Expr(st.slice(fi + (isTable ? 2 : 1)).filter(t => !(t.t === 'p' && t.v === '@')), this).value().js;
    return `$rt.sql.update(${Q(tab)}, ${isTable ? v : `[${v}]`});`;
  }
}

function isLoopSelect(st) {
  const w = st.map(t => (t.t === 'id' ? t.v.toUpperCase() : t.v));
  if (w[1] === 'SINGLE') return false;
  if (w.includes('PACKAGE') && w[w.indexOf('PACKAGE') + 1] === 'SIZE') return true;
  const ii = w.indexOf('INTO'), ai = w.indexOf('APPENDING');
  if (ai >= 0) return false;
  if (ii < 0) return true;
  if (w[ii + 1] === 'TABLE' || (w[ii + 1] === 'CORRESPONDING' && w[ii + 4] === 'TABLE')) return false;
  // aggregates without group by return one row
  const fromI = w.indexOf('FROM');
  const fieldsI = w.indexOf('FIELDS');
  const fieldToks = fieldsI > 0 ? w.slice(fieldsI + 1) : w.slice(1, fromI);
  if (fieldToks.some(x => AGGREGATES.has(x)) && !w.includes('GROUP')) return false;
  return true;
}

function readChain(base, path) {
  let js = base;
  for (const p of path) js = applySeg(js, { op: '-', name: p });
  return js;
}
function applySeg(js, seg) {
  const n = seg.name.toLowerCase();
  if (n === '*') return `$rt.deref(${js})`; // dref->*
  if (seg.op === '->') return `$rt.deref(${js})${optProp(n)}`;   // obj->attr, dref->comp
  if (seg.op === '-' && (n === '%tky' || n === '%key' || n === '%pky')) return `$rt.tky(${js})`;
  if (seg.op === '=>') return `${js}${prop(n)}`;
  return `${js}${optProp(n)}`;
}
function rowComp(row, comp) {
  if (comp && typeof comp === 'object') return `${row}?.[$rt.s(${comp.dyn}).toLowerCase()]`;   // dynamic component ('NAME')
  if (comp === 'table_line') return row;
  return readChain(row, comp.split('-'));
}
function pairs(toks, mc) {
  // a = x b = y ...  -> [[comp, js]]
  const ex = new Expr(toks, mc);
  const out = [];
  while (!ex.done()) {
    if (ex.isP('(')) {
      ex.next(); const dyn = ex.value().js; ex.expectP(')');
      if (ex.isKw('COMPONENTS')) { ex.next(); continue; }   // ( 'KEYNAME' ) COMPONENTS ...: a dynamic key name
      ex.expectP('='); out.push([{ dyn }, ex.value().js]); continue;
    }
    // WITH [TABLE] KEY keyname COMPONENTS a = x ...: the components of a named (secondary) key
    if (isKw(ex.peek(1), 'COMPONENTS')) { ex.next(); ex.next(); continue; }
    const c = ex.next().v.toLowerCase();
    if (!(ex.peek()?.v === '=')) mc.err(`Expected '=' after ${c}`, toks);
    ex.next();
    out.push([c, ex.value().js]);
  }
  return out;
}

function findAssignOp(st) {
  // first top-level '=' / '+=' ... that follows a target
  let depth = 0;
  for (let k = 0; k < st.length; k++) {
    const t = st[k];
    if (t.t === 'p' && (t.v === '(' || t.v === '[')) depth++;
    if (t.t === 'p' && (t.v === ')' || t.v === ']')) depth--;
    if (depth === 0 && t.t === 'p' && ['=', '+=', '-=', '*=', '/=', '?=', '&&='].includes(t.v)) return k;
    if (depth === 0 && t.t === 'id' && k > 0 && !(st[k - 1].t === 'p' && st[k - 1].v === '(')) {
      // a second identifier at top level before '=' means this is not an assignment (e.g. keyword statement)
      if (!(t.t === 'sel')) return -1;
    }
  }
  return -1;
}

function splitTopLevelWord(toks, word) {
  const out = [[]];
  let depth = 0;
  for (const t of toks) {
    if (t.t === 'p' && (t.v === '(' || t.v === '[')) depth++;
    if (t.t === 'p' && (t.v === ')' || t.v === ']')) depth--;
    if (depth === 0 && isKw(t, word)) { out.push([]); continue; }
    out[out.length - 1].push(t);
  }
  return out;
}

// split a token list at top-level keywords: returns { '': [...], KW: [...] }
function splitByKeywords(toks, kws) {
  const out = { '': [] };
  let cur = '';
  let depth = 0;
  for (const t of toks) {
    if (t.t === 'p' && (t.v === '(' || t.v === '[')) depth++;
    if (t.t === 'p' && (t.v === ')' || t.v === ']')) depth--;
    if (depth === 0 && t.t === 'id' && kws.includes(t.v.toUpperCase()) && !(cur === 'TRANSPORTING' && t.v.toUpperCase() === 'FIELDS') && !(cur === 'REFERENCE' && t.v.toUpperCase() === 'INTO' && !out.REFERENCE.length)) {
      cur = t.v.toUpperCase();
      out[cur] = [];
      continue;
    }
    out[cur].push(t);
  }
  return out;
}

class EmlParser {
  constructor(toks, mc) { this.toks = toks; this.i = 0; this.mc = mc; }
  peek() { return this.toks[this.i]; }
  next() { return this.toks[this.i++]; }
  done() { return this.i >= this.toks.length; }
  kw(k) { return isKw(this.peek(), k); }
  expect(k) { if (!this.kw(k)) this.mc.err(`Expected ${k} but found '${this.peek()?.v}'`, this.toks); return this.next(); }
  localMode() { if (this.kw('IN') && isKw(this.toks[this.i + 1], 'LOCAL')) { this.i += 3; return true; } return false; }
  fieldList() {
    this.next(); // (
    const f = [];
    while (!(this.peek().t === 'p' && this.peek().v === ')')) f.push(this.next().v.toLowerCase());
    this.next();
    return f;
  }
  expr() {
    const ex = new Expr(this.toks, this.mc);
    ex.i = this.i;
    const v = ex.value();
    this.i = ex.i;
    return v.js;
  }
  targetToks() {
    const t = this.next();
    if (isKw(t, 'DATA', 'FINAL') && this.peek()?.v === '(') { const r = [t, this.next(), this.next(), this.next()]; return r; }
    return [t];
  }
}

// ---------------------------------------------------- expressions -----------------------------
// value(): { js, kind: 'ref' | 'fresh' | 'prim' }   cond(): js boolean expression
const CMP_WORDS = { EQ: '=', NE: '<>', LT: '<', GT: '>', LE: '<=', GE: '>=' };

class Expr {
  constructor(toks, mc, targetHint = null) { this.toks = toks; this.i = 0; this.mc = mc; this.hint = targetHint; this.rowJs = null; }
  peek(k = 0) { return this.toks[this.i + k]; }
  next() { return this.toks[this.i++]; }
  done() { return this.i >= this.toks.length; }
  isP(v, k = 0) { const t = this.peek(k); return !!t && t.t === 'p' && t.v === v; }
  isKw(...ks) { return isKw(this.peek(), ...ks); }
  expectP(v) { if (!this.isP(v)) this.mc.err(`Expected '${v}' but found '${this.peek()?.v ?? 'end of statement'}'`, this.toks); return this.next(); }
  expectKw(k) { if (!this.isKw(k)) this.mc.err(`Expected ${k} but found '${this.peek()?.v ?? 'end of statement'}'`, this.toks); return this.next(); }

  // ----- conditions
  cond() {
    let l = this.orCond();
    while (this.isKw('EQUIV')) { this.next(); l = `(!!(${l}) === !!(${this.orCond()}))`; }
    return l;
  }
  orCond() {
    let l = this.andCond();
    while (this.isKw('OR')) { this.next(); l = `(${l} || ${this.andCond()})`; }
    return l;
  }
  andCond() {
    let l = this.notCond();
    while (this.isKw('AND')) { this.next(); l = `(${l} && ${this.notCond()})`; }
    return l;
  }
  notCond() {
    if (this.isKw('NOT') && !this.isKw2('NOT', 'IN') && !this.isKw2('NOT', 'BETWEEN')) { this.next(); return `!(${this.notCond()})`; }
    return this.cmp();
  }
  isKw2(a, b) { return isKw(this.peek(), a) && isKw(this.peek(1), b); }
  cmp() {
    // parenthesised condition?
    if (this.isP('(')) {
      const save = this.i;
      this.next();
      try {
        const c = this.cond();
        if (this.isP(')')) {
          this.next();
          if (!this.isCmpOp()) return `(${c})`;
        }
      } catch { /* fall through: arithmetic grouping */ }
      this.i = save;
    }
    // predicate functions
    if (this.isKw('LINE_EXISTS') && this.isP('(', 1)) {
      this.next(); this.next();
      const v = this.tableExprIndex();
      this.expectP(')');
      return `(${v} >= 0)`;
    }
    const lv = this.value();
    const l = lv.js;
    if (this.isKw('IS')) {
      this.next();
      const neg = this.isKw('NOT') ? !!this.next() : false;
      const what = this.next().v.toUpperCase();
      let js;
      // a string is initial only when empty (blanks count)
      if (what === 'INITIAL') js = lv.etype === 'string' ? `($rt.s(${l}) === '')` : `$rt.initial(${l})`;
      else if (what === 'BOUND') js = `(${l} != null)`;
      else if (what === 'ASSIGNED') js = `(${l} !== undefined)`;
      else if (what === 'SUPPLIED') { const nm = this.toks[this.i - 3].v.toLowerCase(); js = `($p${prop(nm)} !== undefined)`; }
      else if (what === 'INSTANCE') { this.expectKw('OF'); js = `$rt.isA(${l}, ${Q(this.next().v.toLowerCase())})`; }
      else this.mc.err(`Unsupported predicate IS ${what}`, this.toks);
      return neg ? `!${js}` : js;
    }
    let neg = false;
    if (this.isKw2('NOT', 'IN') || this.isKw2('NOT', 'BETWEEN')) { this.next(); neg = true; }
    if (this.isKw('IN')) { this.next(); const r = this.value().js; return `${neg ? '!' : ''}$rt.inRange(${l}, ${r})`; }
    if (this.isKw('BETWEEN')) {
      this.next();
      const lo = this.value().js; this.expectKw('AND'); const hi = this.value().js;
      return `${neg ? '!' : ''}($rt.cmp(${l}, ${lo}) >= 0 && $rt.cmp(${l}, ${hi}) <= 0)`;
    }
    if (this.isCmpOp()) {
      const t = this.next();
      let op = t.t === 'p' ? t.v : (CMP_WORDS[t.v.toUpperCase()] || t.v.toUpperCase());
      if (op === '=<') op = '<=';
      if (op === '=>') op = '>=';
      const rv = this.value();
      let r = rv.js;
      // f compared with decfloat: compared as decfloat, the float with its exact binary value
      const dk = k => k === 'decfloat34' || k === 'decfloat16';
      if ((lv.etype === 'f' && dk(rv.etype)) || (rv.etype === 'f' && dk(lv.etype))) {
        const c = lv.etype === 'f' ? `$rt.cmpExact(${l}, ${r})` : `-$rt.cmpExact(${r}, ${l})`;
        return op === '=' ? `(${c} === 0)` : op === '<>' ? `(${c} !== 0)` : `(${c} ${op} 0)`;
      }
      switch (op) {
        case '=': return `$rt.eq(${l}, ${r})`;
        case '<>': return `!$rt.eq(${l}, ${r})`;
        case '<': return `($rt.cmp(${l}, ${r}) < 0)`;
        case '>': return `($rt.cmp(${l}, ${r}) > 0)`;
        case '<=': return `($rt.cmp(${l}, ${r}) <= 0)`;
        case '>=': return `($rt.cmp(${l}, ${r}) >= 0)`;
        default: return `$rt.strop(${Q(op)}, ${l}, ${r})`;
      }
    }
    // predicative method call / boolean function result
    if (lv.bool) return l;
    return `!$rt.initial(${l})`;
  }
  isCmpOp() {
    const t = this.peek();
    if (!t) return false;
    if (t.t === 'p') return ['=', '<>', '<', '>', '<=', '>=', '=<'].includes(t.v);
    if (t.t === 'id') return ['EQ', 'NE', 'LT', 'GT', 'LE', 'GE', 'CS', 'NS', 'CP', 'NP', 'CO', 'CN', 'CA', 'NA'].includes(t.v.toUpperCase());
    return false;
  }

  // ----- values
  value() { return this.concat(); }
  concat() {
    let l = this.bitOr();
    while (this.isP('&&') || this.isP('&')) { this.next(); const r = this.bitOr(); l = { js: `($rt.s(${l.js}) + $rt.s(${r.js}))`, kind: 'prim' }; }
    return l;
  }
  // bit expressions on byte-like operands: BIT-OR < BIT-XOR < BIT-AND < BIT-NOT
  bitOr() { return this.bitLevel('BIT-OR', () => this.bitXor()); }
  bitXor() { return this.bitLevel('BIT-XOR', () => this.bitAnd()); }
  bitAnd() { return this.bitLevel('BIT-AND', () => this.additive()); }
  bitLevel(kw, next) {
    let l = next();
    while (this.isKw(kw)) { this.next(); const r = next(); l = { js: `$rt.bit(${Q(kw)}, ${l.js}, ${r.js})`, kind: 'prim' }; }
    return l;
  }
  additive() {
    let l = this.mult();
    while ((this.isP('+') || this.isP('-')) && this.peek().ws) {
      const op = this.next().v;
      const r = this.mult();
      l = this.arithJs(op, l, r);
    }
    return l;
  }
  // ABAP's calculation type: decfloat if an operand is decfloat, else f, else p, else int8, else i; f is not rounded
  arithJs(op, l, r) {
    const ks = [l.spec?.k ?? l.etype, r.spec?.k ?? r.etype];
    // the target counts too (res TYPE p DECIMALS 2 = 1 / 3 calculates in p)
    if (this.tgtKind === undefined && !this.inCtor) this.tgtKind = (this.hint?.name && this.mc.specOfName(this.hint.name)?.k) || null;
    if (['i', 'int8', 'p', 'f', 'decfloat16', 'decfloat34'].includes(this.tgtKind)) ks.push(this.tgtKind);
    // ** is f unless decfloat is involved; operands typed generically (numeric) calculate in decfloat34
    const ct = ks.includes('decfloat34') || ks.includes('numeric') ? 'decfloat34' : ks.includes('decfloat16') ? 'decfloat16'
      : op === '**' && ks.every(Boolean) ? 'f' : ks.includes('f') ? 'f' : ks.includes('p') ? 'p'
      : ks.every(k => k === 'i' || k === 'int8') ? (ks.includes('int8') ? 'int8' : 'i') : null;
    // a p result has no length or decimals of its own: an inline declaration gets p LENGTH 8 DECIMALS 0
    const spec = ct === 'p' ? { k: 'p', len: 8, dec: 0 } : ct ? { k: ct } : undefined;
    // integer calculation (intermediate results rounded) only where the target is known to be integer or is declared
    // inline; elsewhere (VALUE components, method arguments) the target's type is not known here yet
    const intCalc = (ct === 'i' || ct === 'int8') && !this.inCtor && (this.tgtKind === 'i' || this.tgtKind === 'int8' || this.hint?.inline);
    return { js: `$rt.arith(${Q(op)}, ${this.num(l)}, ${this.num(r)}${ct === 'f' || intCalc ? `, ${Q(ct)}` : ''})`, kind: 'prim', spec, etype: spec?.k };
  }
  mult() {
    let l = this.power();
    while (this.isP('*') || this.isP('/') || this.isKw('DIV', 'MOD')) {
      const t = this.next();
      const op = t.t === 'p' ? t.v : t.v.toUpperCase();
      const r = this.power();
      l = this.arithJs(op, l, r);
    }
    return l;
  }
  power() {
    const l = this.unary();
    if (this.isP('**')) { this.next(); const r = this.power(); return this.arithJs('**', l, r); }
    return l;
  }
  unary() {
    if (this.isKw('BIT-NOT')) { this.next(); const v = this.unary(); return { js: `$rt.bit('BIT-NOT', ${v.js})`, kind: 'prim' }; }
    if (this.isP('-')) { this.next(); const v = this.unary(); return { js: `(-$rt.n(${v.js}))`, kind: 'prim' }; }
    if (this.isP('+')) { this.next(); return this.unary(); }
    return this.postfix(this.primary());
  }

  postfix(v) {
    for (;;) {
      const t = this.peek();
      // chained table expressions: m[ i ][ j ]
      if (t && t.t === 'p' && t.v === '[' && !t.ws && v.kind !== 'prim') return this.tableExpr(v.js);
      // substring access dobj+off(len) / dobj(len): no blanks allowed around + and (
      if (t && t.t === 'p' && t.v === '+' && !t.ws && this.peek(1) && !this.peek(1).ws && (this.peek(1).t === 'num' || this.peek(1).t === 'id')) {
        this.next();
        const offTok = this.next();
        const off = offTok.t === 'num' ? offTok.v : this.mc.readPath(offTok.v);
        let len = 'undefined';
        if (this.isP('(') && !this.peek().ws && this.peek(1) && !this.peek(1).ws) { this.next(); const lt = this.next(); len = lt.t === 'num' ? lt.v : lt.v === '*' ? 'undefined' : this.mc.readPath(lt.v); this.expectP(')'); }
        v = { js: `$rt.sub(${v.js}, ${off}, ${len})`, kind: 'prim' };
        continue;
      }
      // ->* after a table expression or call: data references are represented by their value
      if (t && t.t === 'p' && t.v === '-' && !t.ws && this.peek(1)?.v === '>' && this.peek(2)?.v === '*' && !this.peek(1).ws && !this.peek(2).ws) {
        this.next(); this.next(); this.next();
        v = { js: `$rt.deref(${v.js})`, kind: 'ref' };
        continue;
      }
      // obj->( name ) / dref->( comp ): an attribute or component named at runtime
      if (t && t.t === 'p' && t.v === '-' && !t.ws && this.peek(1)?.v === '>' && this.peek(2)?.v === '(' && !this.peek(1).ws && !this.peek(2).ws) {
        this.next(); this.next(); this.next();
        const name = this.value().js;
        this.expectP(')');
        v = { js: `$rt.deref(${v.js})?.[$rt.s(${name}).toLowerCase()]`, kind: 'ref' };
        continue;
      }
      // ...->*-comp: a component after a dereference
      if (t && t.t === 'p' && t.v === '-' && !t.ws && this.peek(1)?.t === 'id' && !this.peek(1).ws && v.kind === 'ref' && this.toks[this.i - 1]?.v === '*') {
        this.next();
        v = { js: readChain(v.js, this.next().v.toLowerCase().split('-')), kind: 'ref' };
        continue;
      }
      if (t && t.t === 'p' && t.v === '-' && !t.ws && this.peek(1)?.v === '(' && !this.peek(1).ws && v.kind === 'ref') {
        this.next(); this.next();
        const comp = this.value().js;
        this.expectP(')');
        v = { js: `$rt.deref(${v.js})?.[$rt.s(${comp}).toLowerCase()]`, kind: 'ref' };
        continue;
      }
      if (t && t.t === 'sel') {
        this.next();
        const segs = splitPath('x' + t.v).slice(1);
        let js = v.js;
        for (let k = 0; k < segs.length; k++) {
          const s = segs[k];
          if (s.op === '->' && this.isP('(') && !this.peek().ws && k === segs.length - 1) {
            js = this.callJs(js, s.name, true);
          } else js = applySeg(js, s);
        }
        v = { js, kind: 'ref' };
        continue;
      }
      return v;
    }
  }

  primary() {
    const t = this.peek();
    if (!t) this.mc.err('Unexpected end of expression', this.toks);
    if (t.t === 'num') { this.next(); const x = Number(t.v); return { js: String(x), kind: 'prim', spec: Math.abs(x) <= 2147483647 ? { k: 'i' } : { k: 'p', len: 16, dec: 0 }, lit: true }; }
    if (t.t === 'char') { this.next(); return { js: Q(t.v), kind: 'prim', spec: { k: 'c', len: Math.max(1, t.v.length) }, lit: true }; }
    if (t.t === 'str') { this.next(); return { js: Q(t.v), kind: 'prim', spec: { k: 'string' }, lit: true }; }
    if (t.t === 'tpl') { this.next(); return { js: this.template(t.v), kind: 'prim', spec: { k: 'string' } }; }
    if (t.t === 'p' && t.v === '(') {
      this.next();
      const v = this.value();
      this.expectP(')');
      return { js: `(${v.js})`, kind: v.kind };
    }
    if (t.t === 'p' && t.v === '@') { this.next(); return this.primary(); }
    if (t.t !== 'id') this.mc.err(`Unexpected '${t.v}' in expression`, this.toks);
    const u = t.v.toUpperCase();
    const nx = this.peek(1);
    // constructor expressions: VALUE #( ... ), VALUE type( ... )
    const CTORS = ['VALUE', 'CORRESPONDING', 'COND', 'SWITCH', 'CONV', 'NEW', 'REDUCE', 'REF', 'CAST', 'EXACT', 'FILTER'];
    if (CTORS.includes(u) && nx && ((nx.t === 'p' && nx.v === '#') || nx.t === 'id') && this.isP('(', 2) && !this.peek(2).ws) {
      this.next();
      const typ = this.next();
      const typeName = typ.t === 'p' ? '#' : typ.v.toLowerCase();
      this.next(); // (
      // inside a constructor expression the assignment's target does not decide the calculation type
      const tk = this.tgtKind;
      this.inCtor = (this.inCtor || 0) + 1; this.tgtKind = null;
      let v;
      try { v = this.ctor(u, typeName); } finally { this.inCtor--; this.tgtKind = tk; }
      this.expectP(')');
      if (typeName !== '#' && ['VALUE', 'CONV', 'CORRESPONDING', 'EXACT', 'COND', 'SWITCH', 'REDUCE', 'FILTER'].includes(u)) { const sp = this.mc.typeSpec([typ]); if (sp) { v.spec = sp; v.etype ??= sp.k; } }
      return this.postfix(v);
    }
    // inline declaration as operand in some contexts (e.g. INTO DATA(x)) handled by caller
    this.next();
    // dobj(len): length access (a method call always has a blank after the parenthesis)
    if (this.isP('(') && !this.peek().ws && this.peek(1) && !this.peek(1).ws && (this.peek(1).t === 'num') && this.isP(')', 2)) {
      this.next(); const len = this.next().v; this.next();
      return this.postfix({ js: `$rt.sub(${this.pathJs(t.v)}, 0, ${len})`, kind: 'prim' });
    }
    // function / method call
    if (this.isP('(') && !this.peek().ws) {
      const name = t.v;
      const segs = splitPath(name);
      // a method of the class (or its superclasses) wins over a built-in function of the same name (find, condense, ...)
      if (segs.length === 1 && BUILTIN_FUNCS.has(name.toLowerCase()) && !this.mc.cls.hasMethod?.(name.toLowerCase())) return this.builtin(name.toLowerCase());
      if (segs.length === 1 && name.toLowerCase() === 'xsdbool') return this.builtin('xsdbool');
      let objJs;
      let mname = segs[segs.length - 1].name;
      if (segs.length === 1) objJs = 'this';
      else {
        const head = segs.slice(0, -1);
        objJs = this.mc.resolveBase(head[0].name, head[1]?.op ?? segs[segs.length - 1].op);
        for (let k = 1; k < head.length; k++) objJs = applySeg(objJs, head[k]);
      }
      // the type of the RETURNING parameter (own methods, methods of a typed reference): DATA(x) = m( ) is typed
      let rsig = null;
      const lm = mname.toLowerCase();
      const owner = segs.length === 1 || (segs.length === 2 && segs[0].name.toLowerCase() === 'me') ? this.mc.cls.def
        : segs.length === 2 && segs[1].op === '->' ? (n => n && (this.mc.cls.defs.get(n) || KNOWN_CLASSES.get(n)))(this.mc.refTypeOf(segs[0].name))
        : segs.length === 2 && segs[1].op === '=>' ? (this.mc.cls.defs.get(segs[0].name.toLowerCase()) || KNOWN_CLASSES.get(segs[0].name.toLowerCase())) : null;
      for (let d = owner, n = 0; d && !rsig && n < 20; d = d.superName ? (this.mc.cls.defs.get(d.superName) || KNOWN_CLASSES.get(d.superName)) : null, n++) rsig = d.methods.get(lm);
      let rspec;
      try { rspec = rsig?.returning?.typeToks?.length && !rsig.returning.like ? specIn(this.mc, owner, rsig.returning.typeToks) : undefined; } catch { rspec = undefined; }
      return { js: this.callJs(objJs, mname, true), kind: 'fresh', ...(rspec ? { spec: rspec, etype: rspec.k !== 'struct' && rspec.k !== 'table' ? rspec.k : undefined } : {}) };
    }
    // table expression
    if (this.isP('[') && !this.peek().ws) {
      const base = this.pathJs(t.v);
      const v = this.tableExpr(base);
      return v;
    }
    const sp = splitPath(t.v).every((x, k) => !k || x.op === '-') ? this.mc.specOfName(t.v) : null;
    return { js: this.pathJs(t.v), kind: 'ref', etype: sp && sp.k !== 'struct' && sp.k !== 'table' ? sp.k : undefined, spec: sp || undefined };
  }
  // operand of an arithmetic expression: a time field counts in seconds, a date field in days
  num(v) { return v.etype === 't' ? `$rt.tsec(${v.js})` : v.etype === 'd' ? `$rt.dnum(${v.js})` : v.js; }

  pathJs(v) {
    const segs = splitPath(v);
    const base = segs[0].name.toLowerCase();
    // in WHERE conditions of LOOP/DELETE/FOR, unknown names are row components
    if (this.rowJs && segs[1]?.op !== '=>' && segs[1]?.op !== '->' && !this.mc.lookup(base) && base !== 'me' && !this.mc.cls.instanceAttrs.has(base) && !this.mc.cls.staticAttrs.has(base) && !['abap_true', 'abap_false', 'space', 'sy'].includes(base)) {
      if (base === 'table_line') return this.rowJs;
      return readChain(this.rowJs, segs.map(s => s.name));
    }
    return this.mc.readPath(v);
  }

  template(parts) {
    const out = parts.map(p => {
      if (p.text !== undefined) return Q(p.text);
      const ex = new Expr(p.tokens, this.mc);
      ex.rowJs = this.rowJs;
      const val = ex.value();
      const v = val.js;
      // formatting options (ALPHA = OUT, WIDTH = n, DATE = ISO ...)
      const opts = {};
      // a string keeps trailing blanks (only text fields of type c lose them): literals `...`, templates,
      // COND/SWITCH/CONV string( ), and variables of type string
      const t0 = p.tokens[0], w1 = String(p.tokens[1]?.v || '').toLowerCase();
      if ((t0?.t === 'str') || t0?.t === 'tpl' || (t0?.t === 'id' && STRING_FUNCS.has(String(t0.v).toLowerCase()) && p.tokens[1]?.v === '(') || (/^(COND|SWITCH|CONV)$/i.test(String(t0?.v)) && w1 === 'string') || (p.tokens.length >= 1 && val.etype === 'string')) opts.$keep = true;
      if (val.etype === 't' || val.etype === 'd') opts.$type = val.etype;
      while (!ex.done()) {
        const k = ex.next().v.toLowerCase();
        if (ex.isP('=')) { ex.next(); opts[k] = ex.next().v.toUpperCase(); }
      }
      // a packed number shows the decimals of its type (|{ amount }| -> 600.00)
      if (opts.decimals === undefined && val.spec?.k === 'p' && val.spec.dec > 0) opts.decimals = String(val.spec.dec);
      return `$rt.fmt(${v}${Object.keys(opts).length ? ', ' + JSON.stringify(opts) : ''})`;
    });
    return out.length ? `(${out.join(' + ')})` : '""';
  }

  // ----- calls
  // parse "( args )" after the opening paren position; returns JS of the call
  callJs(objJs, mname, functional) {
    this.expectP('(');
    const lname = mname.toLowerCase();
    // RTTS describes the declared type, which only the compiler knows: describe_by_data gets it as $type
    const args = this.callArgs(lname === 'describe_by_data' ? 'p_data' : null);
    this.expectP(')');
    if (objJs === 'super') {
      const key = methodKey(lname);
      return functional ? `super[${Q(key)}](${args.js}).$ret` : `super[${Q(key)}](${args.js})`;
    }
    return functional ? `$rt.fcall(${objJs}, ${Q(lname)}, ${args.js})` : `$rt.call(${objJs}, ${Q(lname)}, ${args.js})`;
  }

  // parse argument list (without parens); returns { js, back: [[name, target]] }
  callArgs(typedParam = null) {
    if (this.isP(')')) return { js: '{}', back: [] };
    const sections = ['EXPORTING', 'IMPORTING', 'CHANGING', 'RECEIVING', 'EXCEPTIONS'];
    const typeOf = v => (typedParam && v.spec && !v.lit ? `, $type: ${JSON.stringify(v.spec)}` : '');
    if (!this.isKw(...sections) && !(this.peek().t === 'id' && this.isP('=', 1))) {
      const v = this.value();
      return { js: `{ $0: ${v.js}${typeOf(v)} }`, back: [] };
    }
    const fields = [];
    const back = [];
    const exceptions = [];
    let section = 'EXPORTING';
    while (!this.isP(')') && !this.done()) {
      if (this.isKw(...sections)) { section = this.next().v.toUpperCase(); continue; }
      const name = this.next().v.toLowerCase();
      this.expectP('=');
      if (section === 'EXPORTING') { const v = this.value(); fields.push(`${Q(name)}: ${v.js}`); if (name === typedParam && v.spec && !v.lit) fields.push(`$type: ${JSON.stringify(v.spec)}`); }
      else if (section === 'IMPORTING' || section === 'RECEIVING') {
        const toks = this.targetToks();
        back.push([section === 'RECEIVING' ? '$ret' : name, toks]);
      } else if (section === 'CHANGING') {
        const toks = this.targetToks();
        const tgt = this.mc.target(toks, this.toks);
        fields.push(`${Q(name)}: ${tgt.read}`);
        back.push([name, toks]);
      } else exceptions.push([name, this.value().js]);   // EXCEPTIONS name = n | OTHERS = n
    }
    return { js: `{ ${fields.join(', ')} }`, back, exceptions };
  }
  targetToks() {
    const start = this.i;
    const t = this.next();
    if (isKw(t, 'DATA', 'FINAL') && this.isP('(')) { this.next(); this.next(); this.next(); }
    return this.toks.slice(start, this.i);
  }

  callStatement() {
    // statement form: supports IMPORTING/CHANGING/RECEIVING back-assignment and chained calls
    const t = this.next();
    const segs = splitPath(t.v);
    let objJs;
    const mname = segs[segs.length - 1].name;
    if (segs.length === 1) objJs = 'this';
    else {
      const head = segs.slice(0, -1);
      objJs = this.mc.resolveBase(head[0].name, head[1]?.op ?? segs[segs.length - 1].op);
      for (let k = 1; k < head.length; k++) objJs = applySeg(objJs, head[k]);
    }
    this.expectP('(');
    const lname = mname.toLowerCase();
    // RTTS describes the declared type, which only the compiler knows: describe_by_data gets it as $type
    const args = this.callArgs(lname === 'describe_by_data' ? 'p_data' : null);
    this.expectP(')');
    let call = objJs === 'super' ? `super[${Q(methodKey(lname))}](${args.js})` : `$rt.call(${objJs}, ${Q(lname)}, ${args.js})`;
    // chained: meth( )->other( )
    if (this.peek()?.t === 'sel') {
      const v = this.postfix({ js: `${call}.$ret`, kind: 'fresh' });
      return `${v.js};`;
    }
    // EXCEPTIONS: a classic exception becomes sy-subrc (0 when the method ends normally)
    const wrap = code => args.exceptions?.length
      ? `try { ${code} $rt.sy.subrc = 0; } catch ($e) { const $n = $rt.classicSubrc($e, { ${args.exceptions.map(([n, v]) => `${Q(n)}: ${v}`).join(', ')} }); if ($n === null) throw $e; $rt.sy.subrc = $n; }`
      : code;
    if (!args.back.length) return wrap(`${call};`);
    const r = this.mc.t();
    return wrap(`{ const ${r} = ${call}; ${args.back.map(([n, toks]) => this.mc.assign(this.mc.target(toks, this.toks), `${r}${prop(n)}`, false)).join(' ')} }`);
  }

  builtin(name) {
    this.expectP('(');
    let js;
    if (name === 'line_exists') { const v = this.tableExprIndex(); js = `(${v} >= 0)`; this.expectP(')'); return { js, kind: 'prim', bool: true }; }
    if (name === 'line_index') { const v = this.tableExprIndex(); this.expectP(')'); return { js: `(${v} + 1)`, kind: 'prim' }; }
    // strlen of a string counts its trailing blanks (only text fields of type c lose them)
    if ((name === 'strlen' || name === 'numofchar') && ((this.peek()?.t === 'id' && this.mc.elemTypeOf(this.peek().v)?.t === 'string') || this.peek()?.t === 'str' || this.peek()?.t === 'tpl')
        && this.isP(')', 1)) {
      const v = this.value().js;
      this.expectP(')');
      return { js: `$rt.s(${v}).length`, kind: 'prim' };
    }
    if (name === 'xsdbool' || name === 'boolc') {
      const c = this.cond();
      this.expectP(')');
      return { js: `(${c} ? "X" : "")`, kind: 'prim' };
    }
    const args = this.callArgs();
    this.expectP(')');
    return { js: `$rt.f.${name}(${args.js})`, kind: 'prim' };
  }

  // itab[ ... ] -> returns JS evaluating to the row (throws if missing unless optional)
  tableExpr(baseJs) {
    const idx = this.tableIndexJs(baseJs);
    let js;
    if (this.optional) js = `${baseJs}[${idx}]`;
    else js = `$rt.tabRow(${baseJs}, ${idx})`;
    return this.postfix({ js, kind: 'ref' });
  }
  tableExprIndex() {
    const t = this.next();
    const base = this.pathJs(t.v);
    return this.tableIndexJs(base);
  }
  tableIndexJs(baseJs) {
    this.expectP('[');
    let js;
    if (this.isKw('TABLE') && isKw(this.peek(1), 'KEY')) this.next();
    if (this.isKw('KEY')) {
      this.next();
      if (this.isP('(')) { this.next(); this.value(); this.expectP(')'); } else this.next();   // KEY name | KEY ('NAME')
      if (this.isKw('COMPONENTS')) this.next();
    }
    if (this.isKw('INDEX') && !this.isP(']', 1)) this.next();   // [ KEY k INDEX n ] (not a variable named index: [ index ])
    if ((this.peek().t === 'id' && this.isP('=', 1)) || (this.isP('(') && this.peek(1)?.t !== 'p')) {
      const conds = [];
      while (!this.isP(']')) {
        let c;
        if (this.isP('(')) { this.next(); c = { dyn: this.value().js }; this.expectP(')'); }   // ('COMP') = value
        else c = this.next().v.toLowerCase();
        this.expectP('=');
        conds.push(`$rt.eq(${rowComp('r', c)}, ${this.value().js})`);
      }
      js = `${baseJs}.findIndex((r) => ${conds.join(' && ')})`;
    } else if (this.isP(']')) js = '0';
    else js = `($rt.n(${this.value().js}) - 1)`;
    this.expectP(']');
    return js;
  }

  // assignment target with postfix (itab[ 1 ]-comp)
  postfixTarget() {
    const t = this.next();
    let baseJs = this.pathJs(t.v);
    if (this.isP('[') && !this.peek().ws) {
      const idx = this.tableIndexJs(baseJs);
      const row = `$rt.tabRow(${baseJs}, ${idx})`;
      const s = this.peek();
      if (s && s.t === 'sel') {
        this.next();
        const path = splitPath('x' + s.v).slice(1).map(x => x.name.toLowerCase());
        return { kind: 'path', base: row, path, read: readChain(row, path) };
      }
      // itab[ ... ]-('COMP') = ...: dynamic component
      if (s?.v === '-' && !s.ws && this.peek(1)?.v === '(' && !this.peek(1).ws) {
        this.next(); this.next();
        const comp = this.value().js;
        this.expectP(')');
        return { kind: 'path', base: row, path: [], pathJs: `[$rt.s(${comp}).toLowerCase()]`, read: `${row}?.[$rt.s(${comp}).toLowerCase()]` };
      }
      return { kind: 'fs', js: row, read: row, rowRef: true };
    }
    this.mc.err('Unsupported assignment target', this.toks);
  }

  namedArgs() {
    const out = [];
    while (!this.done()) {
      const name = this.next().v.toLowerCase();
      this.expectP('=');
      out.push(`${Q(name)}: ${this.value().js}`);
    }
    return `{ ${out.join(', ')} }`;
  }

  // ----- constructor expressions
  ctor(kind, typeName) {
    switch (kind) {
      case 'VALUE': return this.ctorValue(typeName);
      case 'CORRESPONDING': return this.ctorCorresponding(typeName);
      case 'COND': return this.ctorCond(typeName);
      case 'SWITCH': return this.ctorSwitch(typeName);
      case 'CONV': {
        const lets = this.letClause();
        if (lets.length) return this.wrapLets(lets, this.ctor('CONV', typeName));
        const vv = this.value();
        const v = vv.js;
        // into the type's rules (CONV i( time ) gives seconds, CONV c( ... ) cuts at the length ...)
        const sp = typeName === '#' ? (this.hint?.name && !this.inCtor ? this.mc.specOfName(this.hint.name) : null) : this.mc.typeSpec([{ t: 'id', v: typeName }]);
        if (sp && CONVERTED.has(sp.k)) {
          const src = ['i', 'int8', 'p', 'f', 'decfloat16', 'decfloat34'].includes(sp.k) ? this.num(vv)
            : sp.k === 'c' && vv.spec?.k === 'p' && vv.spec.dec > 0 ? `$rt.pstr(${v}, ${vv.spec.dec}, 1)` : v;
          return { js: `$rt.cv(${JSON.stringify(sp)}, ${src})`, kind: 'prim', spec: sp, etype: sp.k };
        }
        if (NUMERIC_TYPES.has(typeName)) return { js: `$rt.n(${v})`, kind: 'prim' };
        if (['string', 'c'].includes(typeName) && vv.spec?.k === 'p' && vv.spec.dec > 0) return { js: `$rt.pstr(${v}, ${vv.spec.dec})`, kind: 'prim', ...(typeName === 'string' ? { etype: 'string', spec: { k: 'string' } } : {}) };
        if (['string', 'c', 'n'].includes(typeName)) return { js: `$rt.s(${v})`, kind: 'prim' };
        return { js: v, kind: 'prim' };
      }
      case 'REF': {
        // REF #( dobj ): a reference to the data object itself (writes through dref->* change it)
        let d = 0, e = this.i;
        for (; e < this.toks.length; e++) { const t = this.toks[e]; if (t.v === '(' || t.v === '[') d++; if (t.v === ')' || t.v === ']') { if (!d) break; d--; } }
        const toks = this.toks.slice(this.i, e);
        let tgt = null;
        try { if (toks.length && toks[0].t === 'id') tgt = this.mc.target(toks, toks); } catch { tgt = null; }
        if (!tgt || tgt.unknown) { const v = this.value(); return { js: `$rt.newRef(${v.js})`, kind: 'fresh' }; }
        this.i = e;
        if (tgt.kind === 'deref') return { js: tgt.js, kind: 'fresh' };
        return { js: `$rt.ref(() => ${tgt.read}, ($v) => { ${this.mc.assign(tgt, '$v', false)} })`, kind: 'fresh' };
      }
      case 'EXACT': case 'CAST': { const v = this.value(); return v; }
      case 'NEW': {
        let cls = typeName;
        // data references are represented by their value: NEW type( ... ) / NEW #( value ) build the value
        const isType = n => this.mc.localTypes?.has(n) || !!this.mc.cls.lookupType(n) || BUILTIN_TYPES.has(n) || DDIC_TABLE_TYPES.has(n) || !!BUILTIN_SPECS[n];
        const box = v => ({ js: `$rt.newRef(${v.js})`, kind: 'fresh' });
        if (cls !== '#' && isType(cls)) return box(this.ctorValue(cls));
        if (cls === '#') {
          cls = this.hint?.js ? this.mc.refTypeOf(this.hint.js) : null;
          if (!cls) {
            if (this.isP(')')) return box({ js: this.hint ? `$rt.initialOf($rt.deref(${this.hint.read}))` : "''" });
            if (!(this.peek()?.t === 'id' && this.isP('=', 1)) && !this.isP('(')) return box({ js: this.value().js });
            return box(this.ctorValue('#'));
          }
        }
        const args = this.callArgs();
        return { js: `$rt.new(${Q(cls)}, ${args.js})`, kind: 'fresh' };
      }
      case 'REDUCE': return this.ctorReduce();
      case 'FILTER': {
        const src = this.value().js;
        let except = false;
        // FILTER #( itab [USING KEY k] [EXCEPT] [IN ftab [USING KEY k]] WHERE c1 = f1 ... ): keys only select an index here
        let ftab = null;
        while (!this.isKw('WHERE') && !this.done()) {
          if (this.isKw('EXCEPT')) { this.next(); except = true; continue; }
          if (this.isKw('IN')) { this.next(); ftab = this.value().js; continue; }
          if (this.isKw('USING')) { this.next(); this.expectKw('KEY'); this.next(); continue; }
          break;
        }
        this.expectKw('WHERE');
        const r = this.mc.t();
        if (ftab) {
          // conditions compare itab components with ftab components: col = fcol AND ...
          const pairs = [];
          while (this.peek()?.t === 'id' && !this.isP(')')) { const a = this.next().v.toLowerCase(); this.expectP('='); pairs.push([a, this.next().v.toLowerCase()]); if (this.isKw('AND')) this.next(); }
          const f = this.mc.t();
          const side = (row, c) => (c === 'table_line' ? row : `${row}${prop(c)}`);
          return { js: `${src}.filter((${r}) => ${except ? '!' : ''}(${ftab}).some((${f}) => ${pairs.map(([a, b]) => `$rt.eq(${side(r, a)}, ${side(f, b)})`).join(' && ') || 'true'}))`, kind: 'fresh' };
        }
        const ex = this.sub();
        ex.rowJs = r;
        const c = ex.cond();
        this.i = ex.i;
        return { js: `${src}.filter((${r}) => ${except ? '!' : ''}(${c}))`, kind: 'fresh' };
      }
    }
  }
  sub() { const e = new Expr(this.toks, this.mc, this.hint); e.i = this.i; e.rowJs = this.rowJs; return e; }

  initialForType(typeName) {
    if (typeName === '#') return this.hint ? `$rt.initialOf(${this.hint.read})` : '[]';
    return initForType([{ t: 'id', v: typeName }], false, this.mc.cls);
  }

  ctorValue(typeName) {
    const r = this.ctorValueRows(typeName);
    // rows of a SORTED table type come in key order
    return r.js.startsWith('$rt.newTab(') || r.js === '[]' || (typeName === '#' && !this.hint) ? r : { ...r, js: `$rt.sortedAs(${r.js}, ${this.initialForType(typeName)})` };
  }
  ctorValueRows(typeName) {
    let base = null;
    if (this.isP(')')) return { js: this.initialForType(typeName), kind: 'fresh' };
    if (this.isKw('BASE')) { this.next(); base = this.value().js; }
    const lets = this.letClause();
    // FOR iterations
    if (this.isKw('FOR')) return this.wrapLets(lets, this.forLoop(base, 'value'));
    // table rows or struct components?
    if (this.isP('(')) return this.wrapLets(lets, this.tableBody(base, null));
    // struct with leading defaults then rows?  comp = v ... ( row ) ...
    const comps = [];
    while (!this.isP(')')) {
      if (this.isP('(')) {
        // defaults followed by rows (table)
        return this.wrapLets(lets, this.tableBody(base, comps));
      }
      if (this.peek().t === 'id' && this.isP('=', 1)) {
        const path = splitPath(this.next().v).map(s => s.name.toLowerCase());
        this.next();
        comps.push([path, this.value().js]);
        continue;
      }
      // VALUE #( itab[ ... ] OPTIONAL | DEFAULT x )
      const save = this.optional;
      this.optional = true;
      const v = this.value();
      this.optional = save;
      if (this.isKw('OPTIONAL')) { this.next(); return { js: `(${v.js} ?? ${this.initialForType(typeName)})`, kind: 'fresh' }; }
      if (this.isKw('DEFAULT')) { this.next(); const d = this.value().js; return { js: `(${v.js} ?? ${d})`, kind: 'fresh' }; }
      return { js: `$rt.clone(${v.js})`, kind: 'fresh' };
    }
    const js = `$rt.struct(${base ? `$rt.clone(${base})` : '{}'}, [${comps.map(([p, v]) => `[${JSON.stringify(p)}, ${v}]`).join(', ')}])`;
    return this.wrapLets(lets, { js, kind: 'fresh' });
  }

  letClause() {
    const lets = [];
    if (!this.isKw('LET')) return lets;
    this.next();
    while (!this.isKw('IN')) {
      const name = this.next().v.toLowerCase();
      this.expectP('=');
      const v = this.value().js;
      const js = jsVar(name) + '$l' + (++this.mc.tmp);
      this.mc.pushScope(new Map([[name, js]]));
      lets.push([js, v]);
    }
    this.next(); // IN
    return lets;
  }
  wrapLets(lets, v) {
    if (!lets.length) return v;
    for (let k = 0; k < lets.length; k++) this.mc.popScope();
    return { js: `((${lets.map(l => l[0]).join(', ')}) => ${v.js})(${lets.map(l => l[1]).join(', ')})`, kind: 'fresh' };
  }

  // rows: ( ... ) ( ... ) ; returns table js
  tableBody(base, defaults) {
    const rows = [];
    while (this.isP('(')) {
      this.next();
      rows.push(this.rowJs2(defaults));
      this.expectP(')');
      // defaults can be changed between rows
      while (this.peek()?.t === 'id' && this.isP('=', 1)) {
        defaults = [...(defaults || [])];
        const path = splitPath(this.next().v).map(s => s.name.toLowerCase());
        this.next();
        defaults.push([path, this.value().js]);
      }
    }
    const items = rows.map(r => (r.spread ? `...${r.js}` : r.js));
    const js = base ? `[...$rt.clone(${base}), ${items.join(', ')}]` : `[${items.join(', ')}]`;
    return { js, kind: 'fresh' };
  }
  rowJs2(defaults) {
    if (this.isP(')')) return { js: defaults?.length ? `$rt.struct({}, [${defaults.map(([p, v]) => `[${JSON.stringify(p)}, ${v}]`).join(', ')}])` : '{}' };
    if (this.isKw('LINES') && isKw(this.peek(1), 'OF')) {
      this.next(); this.next();
      const v = this.value().js;
      let from = '1', to = 'undefined';
      if (this.isKw('FROM')) { this.next(); from = this.value().js; }
      if (this.isKw('TO')) { this.next(); to = this.value().js; }
      return { js: `$rt.clone(${v}).slice($rt.n(${from}) - 1, ${to} === undefined ? undefined : $rt.n(${to}))`, spread: true };
    }
    if (this.peek().t === 'id' && this.isP('=', 1)) {
      const comps = [...(defaults || [])];
      while (!this.isP(')')) {
        const path = splitPath(this.next().v).map(s => s.name.toLowerCase());
        this.expectP('=');
        comps.push([path, this.value().js]);
      }
      return { js: `$rt.struct({}, [${comps.map(([p, v]) => `[${JSON.stringify(p)}, ${v}]`).join(', ')}])` };
    }
    const v = this.value();
    return { js: v.kind === 'ref' ? `$rt.clone(${v.js})` : v.js };
  }

  // FOR var IN itab [INDEX INTO i] [WHERE ( cond )] ... | FOR i = a [THEN b] UNTIL|WHILE cond ...
  forLoop(base, mode, reduce) {
    const loops = [];
    while (this.isKw('FOR')) {
      this.next();
      if (this.isKw('GROUPS')) { loops.push(this.forGroups()); const lets = this.letClause(); if (lets.length) loops[loops.length - 1].lets = lets; continue; }
      const vname = this.next().v.toLowerCase();
      const vjs = jsVar(vname) + '$f' + (++this.mc.tmp);
      if (this.isKw('IN')) {
        this.next();
        let src;
        if (this.isKw('GROUP')) {
          // FOR m IN GROUP grp: the members of a group from FOR GROUPS or LOOP AT ... GROUP BY
          this.next();
          const g = this.next().v.toLowerCase();
          const gjs = this.mc.lookup(g);
          src = gjs && gjs.includes('$g') ? `${gjs}$m` : `gm$${jsVar((gjs || g).replace(/^(this|\$cls)\./, ''))}`;
        } else src = this.value().js;
        const loop = { kind: 'in', vjs, src, idx: null, where: null };
        if (this.isKw('INDEX')) { this.next(); this.expectKw('INTO'); const iname = this.next().v.toLowerCase(); loop.idx = jsVar(iname) + '$i' + this.mc.tmp; loop.iname = iname; }
        if (this.isKw('USING')) { this.next(); this.expectKw('KEY'); this.next(); }
        // FROM i TO j: line range
        if (this.isKw('FROM')) { this.next(); loop.from = this.value().js; }
        if (this.isKw('TO')) { this.next(); loop.to = this.value().js; }
        if (this.isKw('STEP')) { this.next(); loop.step = this.value().js; }
        this.mc.pushScope(new Map([[vname, vjs], ...(loop.iname ? [[loop.iname, loop.idx]] : [])]));
        if (this.isKw('WHERE')) {
          this.next();
          this.expectP('(');
          const ex = this.sub();
          ex.rowJs = vjs;
          loop.where = ex.cond();
          this.i = ex.i;
          this.expectP(')');
        }
        loops.push(loop);
      } else {
        this.expectP('=');
        const init = this.value().js;
        const loop = { kind: 'iter', vjs, init, then: null, until: null, whileC: null };
        this.mc.pushScope(new Map([[vname, vjs]]));
        if (this.isKw('THEN')) { this.next(); loop.then = this.value().js; }
        if (this.isKw('UNTIL')) { this.next(); loop.until = this.cond(); }
        else if (this.isKw('WHILE')) { this.next(); loop.whileC = this.cond(); }
        loops.push(loop);
      }
      const lets = this.letClause();
      if (lets.length) loops[loops.length - 1].lets = lets;
    }
    let inner;
    if (mode === 'value') {
      const rows = [];
      while (this.isP('(')) { this.next(); rows.push(this.rowJs2(null)); this.expectP(')'); }
      inner = rows.map(r => (r.spread ? `$t.push(...${r.js});` : `$t.push(${r.js});`)).join(' ');
    } else inner = reduce();
    let js = inner;
    for (let k = loops.length - 1; k >= 0; k--) {
      const l = loops[k];
      const letDecl = l.lets ? l.lets.map(([n, v]) => `const ${n} = ${v};`).join(' ') : '';
      if (l.kind === 'groups') {
        const t = `${l.vjs}$k`;
        const keyFix = l.sizeComp || l.indexComp ? `Object.assign($rt.clone(${t}g.key), {${l.sizeComp ? ` ${Q(l.sizeComp)}: ${t}g.members.length,` : ''}${l.indexComp ? ` ${Q(l.indexComp)}: ${t}n + 1` : ''} })` : `${t}g.key`;
        js = `{ const ${t}a = ${l.src}; const ${t}m = new Map(); for (const ${l.wjs} of ${t}a) {${l.where ? ` if (!(${l.where})) continue;` : ''} const ${t}x = ${l.keyJs}; const ${t}s = JSON.stringify(${t}x); if (!${t}m.has(${t}s)) ${t}m.set(${t}s, { key: ${t}x, members: [] }); ${t}m.get(${t}s).members.push(${l.wjs}); }
const ${t}l = [...${t}m.values()];${l.order ? ` ${t}l.sort((x, y) => ${l.order} * $rt.cmp(typeof x.key === 'object' ? JSON.stringify(x.key) : x.key, typeof y.key === 'object' ? JSON.stringify(y.key) : y.key));` : ''}
for (let ${t}n = 0; ${t}n < ${t}l.length; ${t}n++) { const ${t}g = ${t}l[${t}n]; const ${l.vjs} = ${keyFix}; const ${l.vjs}$m = ${t}g.members;${l.idx ? ` const ${l.idx} = ${t}n + 1;` : ''} ${letDecl} ${js} } }`;
      } else if (l.kind === 'in') {
        const it = `${l.vjs}$k`;
        // STEP: a negative step runs backwards, from the last line (or FROM) down to the first (or TO)
        const head = l.step
          ? `const ${it}s = $rt.n(${l.step}); if (!${it}s) throw $rt.new('cx_sy_itab_line_not_found', {}); for (let ${it} = ${l.from ? `$rt.n(${l.from}) - 1` : `${it}s < 0 ? ${it}a.length - 1 : 0`}; ${it}s < 0 ? ${it} >= ${l.to ? `$rt.n(${l.to}) - 1` : '0'} : ${it} < ${l.to ? `Math.min(${it}a.length, $rt.n(${l.to}))` : `${it}a.length`}; ${it} += ${it}s)`
          : `for (let ${it} = ${l.from ? `$rt.n(${l.from}) - 1` : '0'}; ${it} < ${l.to ? `Math.min(${it}a.length, $rt.n(${l.to}))` : `${it}a.length`}; ${it}++)`;
        js = `{ const ${it}a = ${l.src}; ${head} { const ${l.vjs} = ${it}a[${it}];${l.idx ? ` const ${l.idx} = ${it} + 1;` : ''}${l.where ? ` if (!(${l.where})) continue;` : ''} ${letDecl} ${js} } }`;
      } else {
        const step = l.then ? `${l.vjs} = ${l.then}` : `${l.vjs} = $rt.n(${l.vjs}) + 1`;
        const test = l.until ? `!(${l.until})` : l.whileC ? `(${l.whileC})` : 'false';
        // UNTIL is checked after each iteration in ABAP; WHILE before
        js = l.until
          ? `{ let ${l.vjs} = ${l.init}; for (let $g = 0; $g < 1e6; $g++) { ${letDecl} ${js} ${step}; if (${l.until.replace(/^/, '')}) break; } }`
          : `{ let ${l.vjs} = ${l.init}; while (${test}) { ${letDecl} ${js} ${step}; } }`;
      }
      if (l.lets) for (let q = 0; q < l.lets.length; q++) this.mc.popScope();
      this.mc.popScope();
    }
    if (mode === 'value') return { js: `(() => { const $t = ${base ? `$rt.clone(${base})` : '[]'}; ${js} return $t; })()`, kind: 'fresh' };
    return js;
  }

  // FOR GROUPS grp OF wa IN itab [INDEX INTO i] [WHERE ( c )] GROUP BY key [ASCENDING|DESCENDING] [WITHOUT MEMBERS]
  forGroups() {
    this.next(); // GROUPS
    const gname = this.next().v.toLowerCase();
    const gjs = jsVar(gname) + '$g' + (++this.mc.tmp);
    this.expectKw('OF');
    const wname = this.next().v.toLowerCase();
    const wjs = jsVar(wname) + '$w' + this.mc.tmp;
    this.expectKw('IN');
    const loop = { kind: 'groups', vjs: gjs, wjs, src: this.value().js };
    if (this.isKw('INDEX')) { this.next(); this.expectKw('INTO'); loop.iname = this.next().v.toLowerCase(); loop.idx = jsVar(loop.iname) + '$i' + this.mc.tmp; }
    if (this.isKw('USING')) { this.next(); this.expectKw('KEY'); this.next(); }
    this.mc.pushScope(new Map([[wname, wjs]]));
    if (this.isKw('WHERE')) { this.next(); this.expectP('('); const ex = this.sub(); ex.rowJs = wjs; loop.where = ex.cond(); this.i = ex.i; this.expectP(')'); }
    this.expectKw('GROUP'); this.expectKw('BY');
    if (this.isP('(') && this.peek(1)?.t === 'id' && this.isP('=', 2)) {
      this.next();
      const comps = [];
      while (!this.isP(')')) {
        const c = this.next().v.toLowerCase();
        this.expectP('=');
        if (this.isKw('GROUP') && isKw(this.peek(1), 'SIZE')) { this.next(); this.next(); loop.sizeComp = c; continue; }
        if (this.isKw('GROUP') && isKw(this.peek(1), 'INDEX')) { this.next(); this.next(); loop.indexComp = c; continue; }
        comps.push(`${Q(c)}: ${this.value().js}`);
      }
      this.next();
      loop.keyJs = `{ ${comps.join(', ')} }`;
    } else loop.keyJs = this.value().js;
    for (;;) {
      if (this.isKw('ASCENDING')) { this.next(); loop.order = 1; if (this.isKw('AS')) { this.next(); this.next(); } continue; }
      if (this.isKw('DESCENDING')) { this.next(); loop.order = -1; if (this.isKw('AS')) { this.next(); this.next(); } continue; }
      if (this.isKw('WITHOUT')) { this.next(); this.next(); continue; }
      break;
    }
    this.mc.popScope();
    this.mc.pushScope(new Map([[gname, gjs], ...(loop.iname ? [[loop.iname, loop.idx]] : [])]));
    return loop;
  }

  ctorReduce() {
    // REDUCE t( [LET x = ... IN] INIT a = x b = y FOR ... NEXT a = ... b = ... )
    const lets = this.letClause();
    if (lets.length) return this.wrapLets(lets, this.ctorReduce());
    this.expectKw('INIT');
    const inits = [];
    while (!this.isKw('FOR')) {
      const name = this.next().v.toLowerCase();
      let v;
      if (this.isKw('TYPE')) { this.next(); const typ = this.next(); v = initForType([typ], false, this.mc.cls); }
      else { this.expectP('='); v = this.value().js; }
      const js = jsVar(name) + '$r' + (++this.mc.tmp);
      inits.push([name, js, v]);
    }
    this.mc.pushScope(new Map(inits.map(([n, j]) => [n, j])));
    const body = this.forLoop(null, 'reduce', () => {
      this.expectKw('NEXT');
      const sets = [];
      while (!this.isP(')')) {
        const tg = this.next().v;
        const segs = splitPath(tg);
        const op = this.next().v;
        const v = this.value().js;
        const js = this.mc.lookup(segs[0].name.toLowerCase());
        if (segs.length > 1) sets.push(`$rt.setp(${js}, ${JSON.stringify(segs.slice(1).map(s => s.name.toLowerCase()))}, ${v});`);
        else if (op === '=') sets.push(`${js} = ${v};`);
        else if (op === '&&=') sets.push(`${js} = $rt.s(${js}) + $rt.s(${v});`);
        else sets.push(`${js} = $rt.arith(${Q(op[0])}, ${js}, ${v});`);
      }
      return sets.join(' ');
    });
    this.mc.popScope();
    return { js: `(() => { ${inits.map(([, j, v]) => `let ${j} = ${v};`).join(' ')} ${body} return ${inits[0][1]}; })()`, kind: 'fresh' };
  }

  ctorCorresponding(typeName) {
    let base = null;
    if (this.isKw('DEEP')) this.next();
    let appending = false;
    if (this.isKw('BASE') || this.isKw('APPENDING')) { appending = this.next().v.toUpperCase() === 'APPENDING'; this.expectP('('); base = this.value().js; this.expectP(')'); }
    if (this.isKw('DEEP')) this.next();
    const src = this.value().js;
    const mapping = [];
    const except = [];
    // CORRESPONDING #( itab FROM lookup_tab USING [KEY k] a = b ... ): fill rows from matching lookup rows
    let lookup = null;
    if (this.isKw('FROM')) {
      this.next();
      const tab = this.value().js;
      if (!this.isKw('USING')) this.mc.err('CORRESPONDING ... FROM needs USING', this.toks);
      this.next();
      if (this.isKw('KEY')) { this.next(); this.next(); }
      const on = [];
      while (this.peek()?.t === 'id' && this.isP('=', 1)) { const l = this.next().v.toLowerCase(); this.next(); on.push([l, this.next().v.toLowerCase()]); if (this.isKw('AND')) this.next(); }
      lookup = { tab, on };
    }
    // additions may come in any order: MAPPING, EXCEPT, DISCARDING DUPLICATES, MAPPING FROM/TO ENTITY, USING CONTROL
    let entityMapping = null;
    while (!this.isP(')') && !this.done()) {
      if (this.isKw('MAPPING') && (isKw(this.peek(1), 'FROM') || isKw(this.peek(1), 'TO')) && isKw(this.peek(2), 'ENTITY')) {
        this.next(); entityMapping = this.next().v.toLowerCase(); this.next();
        continue;
      }
      if (this.isKw('USING') && isKw(this.peek(1), 'CONTROL')) { this.next(); this.next(); continue; }
      if (this.isKw('MAPPING')) {
        this.next();
        while (this.peek()?.t === 'id' && this.isP('=', 1)) {
          const t = this.next().v.toLowerCase(); this.next();
          const s = this.next().v.toLowerCase();
          mapping.push([t, s]);
          if (this.isKw('DEFAULT')) { this.next(); this.value(); }
        }
        continue;
      }
      if (this.isKw('EXCEPT')) {
        this.next();
        while (!this.isP(')') && !this.isKw('MAPPING', 'DISCARDING')) except.push(this.next().v.toLowerCase());
        continue;
      }
      if (this.isKw('DISCARDING')) { this.next(); this.next(); continue; }
      this.mc.err(`Unexpected '${this.peek().v}' in CORRESPONDING`, this.toks);
    }
    const shape = typeName !== '#' ? Q(typeName) : 'null';
    if (entityMapping) return { js: `$rt.mapEntity(${src}, ${Q(entityMapping)}, ${shape})`, kind: 'fresh' };
    if (lookup) return { js: `$rt.correspondingLookup(${src}, ${lookup.tab}, ${JSON.stringify(lookup.on)}, ${JSON.stringify(mapping)}, ${JSON.stringify(except)})`, kind: 'fresh' };
    return { js: `$rt.corresponding(${src}, ${base || 'null'}, ${JSON.stringify(mapping)}, ${JSON.stringify(except)}, ${shape}${appending ? ', false, true' : ''})`, kind: 'fresh' };
  }

  ctorCond(typeName) {
    const parts = [];
    let els = null;
    const lets = this.letClause();
    // COND #( ) without a target takes the type of its first THEN: a string turns integers into text with their sign blank ("99 ")
    let str = null;
    while (this.isKw('WHEN')) {
      this.next();
      const c = this.cond();
      this.expectKw('THEN');
      if (str === null) str = typeName === '#' && !this.hint && (this.peek()?.t === 'str' || this.peek()?.t === 'tpl');
      parts.push([c, parts.length && str ? `$rt.istr(${this.thenValue()})` : this.thenValue()]);
    }
    if (this.isKw('ELSE')) { this.next(); els = str ? `$rt.istr(${this.thenValue()})` : this.thenValue(); }
    if (!els) els = typeName === '#' ? (this.hint ? `$rt.initialOf(${this.hint.read})` : `$rt.initialOf(${parts[0][1]})`) : this.initialForType(typeName);
    let js = els;
    for (let k = parts.length - 1; k >= 0; k--) js = `(${parts[k][0]} ? ${parts[k][1]} : ${js})`;
    return this.wrapLets(lets, str ? { js, kind: 'fresh', etype: 'string' } : { js, kind: 'fresh' });
  }
  thenValue() {
    if (this.isKw('THROW')) {
      this.next();
      const cls = this.next().v.toLowerCase();
      this.expectP('(');
      // THROW cx( MESSAGE e005(msgclass) [WITH a b ...] ) or THROW cx( params )
      if (this.isKw('USING') && isKw(this.peek(1), 'MESSAGE')) {
        // THROW cx( USING MESSAGE ): the message of the last MESSAGE statement (sy-msgid / sy-msgno / sy-msgv1..4)
        this.next(); this.next(); this.expectP(')');
        return `$rt.throw_($rt.new(${Q(cls)}, { textid: { msgid: $rt.sy.msgid, msgno: $rt.sy.msgno }, text: $rt.msgText($rt.s($rt.sy.msgid).toLowerCase(), $rt.sy.msgno, [$rt.sy.msgv1, $rt.sy.msgv2, $rt.sy.msgv3, $rt.sy.msgv4]) }))`;
      }
      if (this.isKw('MESSAGE')) {
        this.next();
        let t, msgid;
        if (this.isKw('ID')) {
          // MESSAGE ID 'CLS' TYPE 'E' NUMBER '002'
          this.next(); msgid = this.next().v;
          this.expectKw('TYPE'); const ty = this.next().v;
          this.expectKw('NUMBER'); t = `${ty}${this.next().v}`.toLowerCase();
        } else {
          t = this.next().v.toLowerCase();
          this.expectP('(');
          msgid = this.next().v;
          this.expectP(')');
        }
        const withArgs = [];
        if (this.isKw('WITH')) { this.next(); while (!this.isP(')') && withArgs.length < 4 && !(this.peek()?.t === 'id' && this.isP('=', 1))) withArgs.push(this.value().js); }
        const more = this.isP(')') ? '{}' : this.callArgs().js;
        this.expectP(')');
        return `$rt.throw_($rt.new(${Q(cls)}, Object.assign(${more}, { textid: { msgid: ${Q(msgid.toUpperCase())}, msgno: ${Q(t.slice(1))} }, text: $rt.msgText(${Q(msgid.toLowerCase())}, ${Q(t.slice(1))}, [${withArgs.join(', ')}]) })))`;
      }
      const args = this.callArgs();
      this.expectP(')');
      return `$rt.throw_($rt.new(${Q(cls)}, ${args.js}))`;
    }
    return this.value().js;
  }
  ctorSwitch(typeName) {
    const lets = this.letClause();
    const subj = this.value().js;
    const sv = '$sw' + (++this.mc.tmp);
    const parts = [];
    let els = null;
    while (this.isKw('WHEN')) {
      this.next();
      const alts = [this.value().js];
      while (this.isKw('OR')) { this.next(); alts.push(this.value().js); }
      this.expectKw('THEN');
      parts.push([alts.map(a => `$rt.eq(${sv}, ${a})`).join(' || '), this.thenValue()]);
    }
    if (this.isKw('ELSE')) { this.next(); els = this.thenValue(); }
    if (!els) els = typeName === '#' ? `$rt.initialOf(${parts[0][1]})` : this.initialForType(typeName);
    let js = els;
    for (let k = parts.length - 1; k >= 0; k--) js = `(${parts[k][0]} ? ${parts[k][1]} : ${js})`;
    return this.wrapLets(lets, { js: `((${sv}) => ${js})(${subj})`, kind: 'fresh' });
  }
}

// ---------------------------------------------------- ABAP SQL --------------------------------
function sqlIdent(name) {
  const n = name.toLowerCase().replace(/~/g, '.');
  return /[^a-z0-9_.*]/.test(n) ? n.split('.').map(p => `"${p}"`).join('.') : n;
}

// ABAP SQL typed literals and the types of CAST, in SQL
const SQL_TYPED_LIT = /^(int1|int2|int4|int8|d16n|d34n|decfloat16|decfloat34|dec|fltp|curr|quan|char|numc|string|sstring|dats|tims|datn|timn|clnt|lang|cuky|unit)$/i;
const SQL_CAST_TYPES = { INT1: 'INTEGER', INT2: 'INTEGER', INT4: 'INTEGER', INT8: 'BIGINT', D16N: 'REAL', D34N: 'REAL', DEC: 'REAL', CURR: 'REAL', QUAN: 'REAL', FLTP: 'REAL',
  CHAR: 'TEXT', NUMC: 'TEXT', SSTRING: 'TEXT', STRING: 'TEXT', DATS: 'TEXT', TIMS: 'TEXT', DATN: 'TEXT', TIMN: 'TEXT', CLNT: 'TEXT', LANG: 'TEXT', CUKY: 'TEXT', UNIT: 'TEXT' };

class SqlBuilder {
  constructor(mc) { this.mc = mc; this.params = []; this.ranges = []; this.fae = null; }

  withCte(st) { return this.select(this.ctes(st)); }
  // WITH +name [( cols )] AS ( SELECT ... ), ... : sets the CTE prefix, returns the main SELECT's tokens
  ctes(st) {
    let k = 1;
    const parts = [];
    while (k < st.length && !isKw(st[k], 'SELECT')) {
      if (st[k].v === ',') { k++; continue; }
      if (st[k].v !== '+') this.mc.err(`Expected +name in WITH, found '${st[k].v}'`, st);
      const name = st[k + 1].v.toLowerCase();
      k += 2;
      let cols = '';
      if (st[k].v === '(') { const e = st.findIndex((t, q) => q > k && t.v === ')'); cols = `(${st.slice(k + 1, e).filter(t => t.v !== ',').map(t => `"${t.v.toLowerCase()}"`).join(', ')})`; k = e + 1; }
      if (!isKw(st[k], 'AS')) this.mc.err('Expected AS in WITH', st);
      k++;
      let d = 0, e = k;
      for (; e < st.length; e++) { if (st[e].v === '(') d++; if (st[e].v === ')') { d--; if (!d) break; } }
      parts.push(`"cte_${name}"${cols} AS (${this.subquery(st.slice(k + 1, e))})`);
      k = e + 1;
    }
    this.ctePrefix = `WITH ${parts.join(', ')} `;
    return st.slice(k);
  }
  // a subquery in ABAP SQL clause order (SELECT [FROM x FIELDS] ... ) as SQL
  subquery(toks) {
    const w = toks.map(t => (t.t === 'id' ? t.v.toUpperCase() : t.v));
    const fi = w.indexOf('FIELDS');
    if (w[1] === 'FROM' && fi > 0) {
      const ends = ['WHERE', 'GROUP', 'HAVING', 'ORDER', 'UP'];
      let e = fi + 1;
      while (e < toks.length && !ends.includes(w[e])) e++;
      toks = [toks[0], ...toks.slice(fi + 1, e), ...toks.slice(1, fi), ...toks.slice(e)];
    }
    return this.translate(toks);
  }
  paramsJs() { return `[${this.params.map(p => `($fae) => ${p}`).join(', ')}]`; }

  // translate ABAP SQL tokens into SQL text, host variables become ? parameters
  translate(toks) {
    const out = [];
    for (let k = 0; k < toks.length; k++) {
      const t = toks[k];
      // common table expression name: +cte
      if (t.t === 'p' && t.v === '+' && toks[k + 1]?.t === 'id' && !toks[k + 1].ws && (k === 0 || out[out.length - 1] !== undefined)) {
        const prev = out[out.length - 1];
        if (k === 0 || ['FROM', 'JOIN', ',', '('].includes(prev) || /^(FROM|JOIN)$/i.test(prev)) { out.push(`"cte_${toks[k + 1].v.toLowerCase()}"`); k++; continue; }
      }
      // path expressions: \_assoc[ ... ]-field (field list, conditions) and view\_assoc (data source)
      if (t.t === 'id' && t.v.includes('\\')) {
        const [head, ...steps] = t.v.toLowerCase().split('\\');
        let field = null, join = null, filter = null;
        const lastSplit = steps[steps.length - 1].split('-');
        steps[steps.length - 1] = lastSplit[0];
        if (lastSplit[1]) field = lastSplit.slice(1).join('-');
        if (toks[k + 1]?.v === '[' && !toks[k + 1].ws) {
          let d = 0, j = k + 1;
          for (; j < toks.length; j++) { if (toks[j].v === '[') d++; if (toks[j].v === ']') { d--; if (!d) break; } }
          const inner = toks.slice(k + 2, j);
          if (inner.some(x => isKw(x, 'INNER'))) join = 'INNER JOIN';
          const wi = inner.findIndex(x => isKw(x, 'WHERE'));
          if (wi >= 0) filter = this.translate(inner.slice(wi + 1));
          k = j;
          if (toks[k + 1]?.t === 'sel') { field = toks[k + 1].v.replace(/^-/, '').toLowerCase(); k++; }
        }
        (this.paths ||= []).push({ head: head || null, steps, field, join, filter });
        out.push(`__PATH_${this.paths.length - 1}__`);
        continue;
      }
      if (t.t === 'p' && t.v === '@') {
        const nt = toks[k + 1];
        if (nt.t === 'p' && nt.v === '(') {
          // @( expr )
          let depth = 0, j = k + 1;
          for (; j < toks.length; j++) { if (toks[j].v === '(') depth++; if (toks[j].v === ')') { depth--; if (!depth) break; } }
          const ex = new Expr(toks.slice(k + 2, j), this.mc);
          this.params.push(ex.value().js);
          out.push('?');
          k = j;
          continue;
        }
        const segs = splitPath(nt.v);
        if (this.fae && segs[0].name.toLowerCase() === this.fae.name && segs.length > 1) {
          this.params.push(readChain('$fae', segs.slice(1).map(s => s.name)));
        } else this.params.push(this.mc.readPath(nt.v));
        // range table: col IN @range
        if (out.length && out[out.length - 1] === 'IN') {
          out.pop();
          const col = out.pop();
          this.ranges.push(this.params.length - 1);
          out.push(`__RANGE_${this.params.length - 1}__${col}__`);
        } else out.push('?');
        k++;
        continue;
      }
      // typed literals: int4`5`, d34n`1.5`, decfloat34`1.333`, char`x` ...
      if (t.t === 'id' && SQL_TYPED_LIT.test(t.v) && (toks[k + 1]?.t === 'str' || toks[k + 1]?.t === 'char') && !toks[k + 1].ws) {
        const v = toks[++k].v;
        out.push(/^(char|numc|string|sstring|dats|tims|datn|timn|clnt|lang|cuky|unit)$/i.test(t.v) ? `'${v.replace(/'/g, "''")}'` : String(Number(v)));
        continue;
      }
      // AS: a type inside CAST( ... AS type ), else an alias (quoted: aliases may be SQL words such as add or div)
      if (t.t === 'id' && out[out.length - 1] === 'AS' && t.v !== '*') {
        const ty = SQL_CAST_TYPES[t.v.toUpperCase()];
        if (ty && (toks[k + 1]?.v === ')' || toks[k + 1]?.v === '(')) { out.push(ty); if (toks[k + 1]?.v === '(') { let d = 0; for (k++; k < toks.length; k++) { if (toks[k].v === '(') d++; if (toks[k].v === ')' && !--d) break; } } continue; }
        out.push(`"${t.v.toLowerCase()}"`);
        continue;
      }
      if (t.t === 'char' || t.t === 'str') { out.push(`'${t.v.replace(/'/g, "''")}'`); continue; }
      if (t.t === 'num') { out.push(t.v); continue; }
      if (t.t === 'p') {
        if (t.v === '(' && out.length && /^[A-Za-z_]/.test(out[out.length - 1]) && !t.ws) { out[out.length - 1] += '('; continue; }
        out.push(t.v === '<>' ? '<>' : t.v);
        continue;
      }
      if (t.t === 'id') {
        const u = t.v.toUpperCase();
        if (CMP_WORDS[u]) { out.push(CMP_WORDS[u] === '=' ? '=' : CMP_WORDS[u]); continue; }
        if (['AND', 'OR', 'NOT', 'IS', 'NULL', 'LIKE', 'IN', 'BETWEEN', 'AS', 'ASCENDING', 'DESCENDING', 'DISTINCT', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END', 'INNER', 'LEFT', 'OUTER', 'JOIN', 'ON', 'COUNT', 'MAX', 'MIN', 'SUM', 'AVG', 'ESCAPE'].includes(u)) {
          out.push(u === 'ASCENDING' ? 'ASC' : u === 'DESCENDING' ? 'DESC' : u);
          continue;
        }
        if (u === 'INITIAL') { // col IS INITIAL
          const neg = out[out.length - 1] === 'NOT';
          if (neg) out.pop();
          out.pop(); // IS
          const col = out.pop();
          out.push(`(${neg ? 'NOT ' : ''}COALESCE(CAST(${col} AS TEXT), '') IN ('', '0', '0.0'))`); // portable across SQLite / PostgreSQL
          continue;
        }
        out.push(sqlIdent(t.v));
        if (t.t === 'id' && toks[k + 1]?.t === 'p' && toks[k + 1].v === '(' && !toks[k + 1].ws) { /* function call handled above */ }
        continue;
      }
      out.push(t.v);
    }
    return out.join(' ').replace(/\( /g, '(').replace(/ \)/g, ')').replace(/(\w)\( ?/g, '$1(');
  }

  select(st, rawTarget = false) {
    this.rawTarget = rawTarget;
    // WITH PRIVILEGED ACCESS: no CDS access control
    const pi = st.findIndex((t, k) => isKw(t, 'WITH') && isKw(st[k + 1], 'PRIVILEGED') && isKw(st[k + 2], 'ACCESS'));
    const privileged = pi >= 0;
    if (privileged) st = [...st.slice(0, pi), ...st.slice(pi + 3)];
    const w = st.map(t => (t.t === 'id' ? t.v.toUpperCase() : t.v));
    // split clauses at top level keywords
    const clauses = {};
    const KW = [['SELECT'], ['SINGLE'], ['FROM'], ['FIELDS'], ['WHERE'], ['GROUP', 'BY'], ['HAVING'], ['ORDER', 'BY'], ['INTO'], ['APPENDING'], ['UP', 'TO'], ['OFFSET'], ['FOR', 'ALL', 'ENTRIES', 'IN']];
    let cur = null, depth = 0;
    for (let k = 0; k < st.length; k++) {
      const t = st[k];
      if (t.t === 'p' && t.v === '(') depth++;
      if (t.t === 'p' && t.v === ')') depth--;
      if (depth === 0 && t.t === 'id') {
        const m = KW.find(seq => seq.every((s, q) => w[k + q] === s));
        if (m && !(cur === 'FROM' && m[0] === 'SINGLE') && !((cur === 'INTO' || cur === 'APPENDING') && m[0] === 'FIELDS')) {
          cur = m.join(' ');
          clauses[cur] = clauses[cur] || [];
          k += m.length - 1;
          continue;
        }
      }
      if (cur) clauses[cur].push(t);
    }
    const single = 'SINGLE' in clauses;
    let fieldToks = clauses.FIELDS || clauses.SELECT || [];
    if (single && clauses.SINGLE?.length) fieldToks = clauses.SINGLE;
    let distinct = false;
    if (isKw(fieldToks[0], 'DISTINCT')) { distinct = true; fieldToks = fieldToks.slice(1); }
    if (clauses['FOR ALL ENTRIES IN']) {
      const ft = clauses['FOR ALL ENTRIES IN'].filter(t => !(t.t === 'p' && t.v === '@'));
      this.fae = { name: ft[0].v.toLowerCase(), js: this.mc.readPath(ft[0].v) };
    }
    // field list: allow space separated (old syntax)
    const hasComma = fieldToks.some(t => t.t === 'p' && t.v === ',');
    let fields;
    let nFields;
    const items = [];
    for (let k = 0; k < fieldToks.length; k++) {
      if (fieldToks[k].t === 'p' && fieldToks[k].v === '@') { items.push([fieldToks[k], fieldToks[k + 1]]); k++; } else items.push([fieldToks[k]]);
    }
    if (!hasComma && items.length > 1 && !fieldToks.some(t => t.t === 'p' && t.v === '(') && !fieldToks.some(t => isKw(t, 'AS', 'CASE'))) {
      fields = items.map(t => this.translate(t)).join(', ');
      nFields = items.length;
    } else {
      fields = this.translate(fieldToks);
      nFields = splitTopLevelComma(fieldToks).length;
    }
    const isStar = fields.trim() === '*';
    const aggregateOnly = !clauses['GROUP BY'] && splitTopLevelComma(fieldToks).every(f => f.length && isKw(f[0], ...AGGREGATES));
    let sql = `${this.ctePrefix || ''}SELECT ${distinct ? 'DISTINCT ' : ''}${fields} FROM ${this.translate(clauses.FROM || [])}`;
    // dynamic clauses: WHERE (lv_where), ORDER BY (lv_orderby) — a host variable holding ABAP SQL text
    const dynamic = toks => toks?.length === 3 && toks[0].v === '(' && toks[2].v === ')' && toks[1].t === 'id' ? this.mc.readPath(toks[1].v) : null;
    const dyn = [];
    const dw = dynamic(clauses.WHERE), dord = dynamic(clauses['ORDER BY']);
    if (dw) { dyn.push(dw); sql += ' WHERE __DYN_0__'; }
    else if (clauses.WHERE) sql += ` WHERE ${this.translate(clauses.WHERE)}`;
    if (clauses['GROUP BY']) sql += ` GROUP BY ${this.translate(clauses['GROUP BY'])}`;
    if (clauses.HAVING) sql += ` HAVING ${this.translate(clauses.HAVING)}`;
    if (dord) { dyn.push(dord); sql += ` ORDER BY __DYN_${dyn.length - 1}__`; }
    else if (clauses['ORDER BY'] && !isKw(clauses['ORDER BY'][0], 'PRIMARY')) sql += ` ORDER BY ${this.translate(clauses['ORDER BY'])}`;
    if (single) sql += ' LIMIT 1';
    else if (clauses['UP TO']) {
      const n = clauses['UP TO'].filter(t => !isKw(t, 'ROWS'));
      sql += ` LIMIT ${this.translate(n)}`;
      if (clauses.OFFSET) sql += ` OFFSET ${this.translate(clauses.OFFSET)}`;
    }
    // INTO / APPENDING [INDICATORS [NOT] NULL STRUCTURE s]
    let indicators = null;
    for (const c of ['INTO', 'APPENDING']) {
      const k = (clauses[c] || []).findIndex(t => isKw(t, 'INDICATORS'));
      if (k < 0) continue;
      const rest = clauses[c].slice(k);
      const si = rest.findIndex(t => isKw(t, 'STRUCTURE'));
      indicators = { name: rest[si + 1].v.toLowerCase(), not: rest.some(t => isKw(t, 'NOT')) };
      clauses[c] = clauses[c].slice(0, k);
    }
    const intoToks = clauses.INTO || clauses.APPENDING;
    if (!intoToks) this.mc.err('SELECT without INTO', st);
    let it = intoToks;
    let corresponding = false, table = false;
    if (isKw(it[0], 'CORRESPONDING')) { corresponding = true; it = it.slice(3); }
    if (isKw(it[0], 'TABLE')) { table = true; it = it.slice(1); }
    if (isKw(it[0], 'NEW')) it = it.slice(1);
    if (!it.length) this.mc.err('SELECT: missing INTO target', st);
    const mode = single || (!table && aggregateOnly) ? 'single' : 'table';
    let assign;
    const t = this.mc.t();
    if (it[0].t === 'p' && it[0].v === '(') {
      // INTO (@a, @b)
      const tg = splitTopLevelComma(it.slice(1, -1)).map(x => this.mc.target(x.filter(y => y.v !== '@'), st));
      assign = `if (${t}) { const $vals = Object.values(${t}); ${tg.map((g, n) => this.mc.assign(g, `$vals[${n}]`, false)).join(' ')} }`;
    } else {
      const tgt = this.rawTarget ? { kind: 'var', js: it.filter(y => y.v !== '@')[0].v, read: it.filter(y => y.v !== '@')[0].v } : this.mc.target(it.filter(y => y.v !== '@'), st);
      const scalar = mode === 'single' && nFields === 1 && !isStar && !corresponding;
      // INTO @DATA(x): x has the types of the selected columns of the dictionary source (decimals of amounts ...)
      const inl = it.filter(y => y.v !== '@');
      if (isKw(inl[0], 'DATA', 'FINAL') && inl[1]?.v === '(' && DDIC_SPEC && !clauses.APPENDING) {
        const from = clauses.FROM || [];
        const src = from.length && !from.some(x => isKw(x, 'JOIN')) ? DDIC_SPEC(String(from[0].v).toLowerCase()) : null;
        if (src?.k === 'struct') {
          let line = src;
          if (!isStar) {
            const comps = {};
            for (const part of splitTopLevelComma(fieldToks)) {
              const f = part.filter(x => x.v !== '@');
              if (f.length === 1 && f[0].t === 'id') { const n = String(f[0].v).toLowerCase().split('~').pop(); comps[n] = src.comps[n] ?? null; }
              else if (f.length === 3 && isKw(f[1], 'AS') && f[0].t === 'id') comps[String(f[2].v).toLowerCase()] = src.comps[String(f[0].v).toLowerCase().split('~').pop()] ?? null;
              else { line = null; break; }
            }
            if (line) line = { k: 'struct', comps };
          }
          const spec = !line ? null : scalar ? Object.values(line.comps)[0] : mode === 'single' ? line : { k: 'table', line };
          if (spec) this.mc.varSpecs.set(String(inl[2].v).toLowerCase(), spec);
        }
      }
      if (clauses.APPENDING) assign = `${tgt.read}.push(...${t});`;
      else if (mode === 'single') assign = `if (${t}) ${this.mc.assign(tgt, scalar ? `Object.values(${t})[0]` : (corresponding ? `$rt.corresponding(${t}, ${tgt.read}, [], [], null, true)` : t), false)}`;
      else assign = this.mc.assign(tgt, t, false);
    }
    const spec = `{ sql: ${Q(sql)}, params: ${this.paramsJs()}, ranges: ${JSON.stringify(this.ranges)}, single: ${mode === 'single'}${this.fae ? `, fae: ${this.fae.js}` : ''}${dyn.length ? `, dyn: [${dyn.join(', ')}]` : ''}${privileged ? ', privileged: true' : ''}${indicators ? `, indicators: ${JSON.stringify(indicators)}` : ''}${this.paths?.length ? `, paths: ${JSON.stringify(this.paths)}` : ''} }`;
    return `{ const ${t} = $rt.sql.select(${spec}); ${assign} }`;
  }
}

function splitTopLevelComma(toks) {
  const out = [[]];
  let depth = 0;
  for (const t of toks) {
    if (t.t === 'p' && t.v === '(') depth++;
    if (t.t === 'p' && t.v === ')') depth--;
    if (depth === 0 && t.t === 'p' && t.v === ',') { out.push([]); continue; }
    out[out.length - 1].push(t);
  }
  return out.filter(x => x.length);
}
