// Parser for CDS sources: define table, define [root] view entity (select / projection),
// define abstract entity, annotate entity (metadata extensions) and define service.
// All entity/element names are normalised to lower case in `name`; the original spelling is kept in `label`.
import { tokenize, TokenStream } from './lexer.js';

export function parseCds(src, file) {
  const s = new TokenStream(tokenize(src, file), file);
  const defs = [];
  while (!s.eof()) {
    const ann = parseAnnotations(s);
    if (s.eof()) break;
    if (s.is('define')) defs.push(parseDefine(s, ann));
    else if (s.is('annotate')) defs.push(parseAnnotate(s, ann));
    else if (s.is('extend')) { s.fail('EXTEND is not supported yet'); }
    else s.fail(`Expected DEFINE or ANNOTATE but found '${s.peek().v}'`);
    s.accept(';');
  }
  return defs;
}

// ---------- annotations ----------
export function parseAnnotations(s, target = {}) {
  while (s.is('@')) {
    s.next();
    if (s.is('<')) s.next(); // @<UI... (annotation for preceding element)
    const path = [s.ident().toLowerCase()];
    while (s.is('.')) { s.next(); path.push(s.ident().toLowerCase()); }
    let value = true;
    if (s.accept(':')) value = parseAnnValue(s);
    setPath(target, path, value);
  }
  return target;
}

function parseAnnValue(s) {
  if (s.accept('{')) {
    const obj = {};
    while (!s.is('}')) {
      const path = [s.ident().toLowerCase()];
      while (s.is('.')) { s.next(); path.push(s.ident().toLowerCase()); }
      let v = true;
      if (s.accept(':')) v = parseAnnValue(s);
      setPath(obj, path, v);
      if (!s.accept(',')) break;
    }
    s.expect('}');
    return obj;
  }
  if (s.accept('[')) {
    const arr = [];
    while (!s.is(']')) { arr.push(parseAnnValue(s)); if (!s.accept(',')) break; }
    s.expect(']');
    return arr;
  }
  const t = s.next();
  if (t.t === 'str') return t.v;
  if (t.t === 'num') return Number(t.v);
  if (t.t === 'p' && t.v === '-' && s.peek().t === 'num') return -Number(s.next().v);
  if (t.t === 'p' && t.v === '#') return '#' + s.ident().toUpperCase();
  if (t.t === 'id') {
    const l = t.v.toLowerCase();
    if (l === 'true') return true;
    if (l === 'false') return false;
    let v = t.v; // unquoted reference, e.g. element name
    while (s.is('.')) { s.next(); v += '.' + s.ident(); }
    return v;
  }
  s.fail(`Unexpected '${t.v}' in annotation value`, t);
}

export function setPath(obj, path, value) {
  let o = obj;
  for (let i = 0; i < path.length - 1; i++) {
    if (typeof o[path[i]] !== 'object' || o[path[i]] === null || Array.isArray(o[path[i]])) o[path[i]] = {};
    o = o[path[i]];
  }
  const last = path[path.length - 1];
  if (isPlain(o[last]) && isPlain(value)) mergeDeep(o[last], value);
  else o[last] = value;
}
const isPlain = v => typeof v === 'object' && v !== null && !Array.isArray(v);
export function mergeDeep(a, b) {
  for (const [k, v] of Object.entries(b)) {
    if (isPlain(a[k]) && isPlain(v)) mergeDeep(a[k], v); else a[k] = v;
  }
  return a;
}

// ---------- types ----------
function parseType(s) {
  let name = s.ident();
  if (name.toLowerCase() === 'abap' && s.is('.')) { s.next(); name = 'abap.' + s.ident(); }
  const type = { name: name.toLowerCase() };
  if (s.is('(')) {
    s.next();
    type.len = Number(s.next().v);
    if (s.accept(',')) type.dec = Number(s.next().v);
    s.expect(')');
  }
  return type;
}

// ---------- define ----------
function parseDefine(s, ann) {
  const start = s.peek();
  s.expect('define');
  const root = !!s.accept('root');
  if (s.is('table') && !s.is('function', 1)) { s.next(); return parseTable(s, ann); }
  // a DDIC structure (ADT: define structure): components, include structures, currency / quantity references
  if (s.accept('structure')) return { ...parseTable(s, ann), kind: 'structure' };
  if (s.accept('service')) return parseService(s, ann);
  if (s.accept('abstract')) { s.expect('entity'); return parseFieldList(s, ann, 'abstract', root); }
  if (s.accept('custom')) { s.expect('entity'); return parseFieldList(s, ann, 'custom', root); }
  if (s.acceptSeq('table', 'function')) {
    const label = s.ident();
    const params = s.accept('with') ? (s.expect('parameters'), parseParams(s)) : [];
    s.expect('returns');
    const tf = parseFieldList(s, ann, 'tablefunction', root, label);
    s.expect('implemented'); s.expect('by'); s.expect('method');
    tf.implementedBy = s.ident();
    if (s.accept('=>')) tf.implementedBy += '=>' + s.ident();
    tf.params = params;
    return tf;
  }
  if (s.accept('view')) {
    s.accept('entity');
    return parseView(s, ann, root, start);
  }
  if (s.accept('hierarchy')) return parseHierarchy(s, ann, start);
  s.fail(`Unsupported definition '${s.peek().v}'`);
}

function parseTable(s, ann) {
  const label = s.ident();
  s.expect('{');
  const fields = [];
  while (!s.is('}')) {
    const fann = parseAnnotations(s);
    if (s.is('}')) break;
    const line = s.peek().line;
    if (s.accept('include')) {
      const inc = s.ident();
      // include zstruct [with suffix _x]
      const suffix = s.acceptSeq('with', 'suffix') ? s.ident() : undefined;
      fields.push({ include: inc.toLowerCase(), suffix, ann: fann, line });
      s.skipUntil(';'); s.expect(';'); continue;
    }
    const key = !!s.accept('key');
    const fname = s.ident();
    s.expect(':');
    const type = parseType(s);
    const notNull = s.acceptSeq('not', 'null');
    // with foreign key [card] checktable where … : the check table is kept (value checks, abapGit CHECKTABLE)
    let checkTable, fkPairs;
    if (s.acceptSeq('with', 'foreign', 'key')) {
      if (s.is('[')) { while (!s.eof() && !s.is(']')) s.next(); s.accept(']'); }
      if (s.peek().t === 'id' && !s.is('where')) checkTable = s.ident().toLowerCase();
      // where <check table field> = <table>.<field> and …
      if (s.accept('where')) {
        fkPairs = [];
        while (!s.eof() && !s.is(';')) {
          const ck = s.peek().t === 'id' ? s.ident().toLowerCase() : null;
          if (!ck || !s.accept('=')) break;
          let own = s.peek().t === 'id' ? s.ident() : (s.peek().t === 'str' ? `'${s.next().v}'` : s.next().v);
          if (s.accept('.')) own = s.ident();
          fkPairs.push([ck, String(own).toLowerCase()]);
          if (!s.accept('and')) break;
        }
      }
    }
    s.skipUntil(';'); // value help and the foreign key's where clause are not needed by the runtime
    s.expect(';');
    fields.push({ name: fname.toLowerCase(), label: fname, key, type, notNull, ann: fann, line, ...(checkTable ? { checkTable } : {}), ...(fkPairs ? { fkPairs } : {}) });
  }
  s.expect('}');
  return { kind: 'table', name: label.toLowerCase(), label, ann, fields };
}

function parseParams(s) {
  const params = [];
  do {
    const pann = parseAnnotations(s);
    const name = s.ident();
    s.expect(':');
    params.push({ name: name.toLowerCase(), label: name, type: parseType(s), ann: pann });
  } while (s.accept(','));
  return params;
}

function parseFieldList(s, ann, kind, root, presetLabel) {
  const label = presetLabel || s.ident();
  if (s.accept('with')) { s.expect('parameters'); s.skipUntil('{'); }
  s.expect('{');
  const fields = [];
  while (!s.is('}')) {
    const fann = parseAnnotations(s);
    if (s.is('}')) break;
    const key = !!s.accept('key');
    const fname = s.ident();
    s.expect(':');
    let type;
    if (s.is('association') || s.is('composition')) { s.skipUntil(';'); s.expect(';'); continue; }
    type = parseType(s);
    s.skipUntil(';'); s.expect(';');
    fields.push({ name: fname.toLowerCase(), label: fname, key, type, ann: fann });
  }
  s.expect('}');
  return { kind, name: label.toLowerCase(), label, ann, root, fields };
}

function parseService(s, ann) {
  const label = s.ident();
  s.expect('{');
  const exposes = [];
  while (!s.is('}')) {
    parseAnnotations(s);
    s.expect('expose');
    const entity = s.ident();
    let alias = entity;
    if (s.accept('as')) alias = s.ident();
    s.expect(';');
    exposes.push({ entity: entity.toLowerCase(), alias });
  }
  s.expect('}');
  return { kind: 'service', name: label.toLowerCase(), label, ann, exposes };
}

// define hierarchy H [with parameters ...] as parent child hierarchy( source S child to parent association _A
//   [period from ... to ... valid from ... to ...] start where <cond> siblings order by f [ascending|descending], ...
//   [depth n] [multiple parents ...] [orphans ...] [cycles ...] [generate spantree] ) { elements }
function parseHierarchy(s, ann, start) {
  const label = s.ident();
  const view = { kind: 'view', name: label.toLowerCase(), label, ann, root: false, joins: [], assocs: [], elements: [], line: start.line };
  if (s.accept('with')) { s.expect('parameters'); view.params = parseParams(s); }
  s.expect('as'); s.expect('parent'); s.expect('child'); s.expect('hierarchy'); s.expect('(');
  const h = { order: [], depth: null };
  s.expect('source');
  view.from = parseSource(s);
  h.source = view.from.name;
  s.expect('child'); s.expect('to'); s.expect('parent'); s.expect('association');
  h.assoc = s.ident().toLowerCase();
  while (!s.is(')')) {
    if (s.accept('start')) { s.expect('where'); h.start = parseExpr(s); continue; }
    if (s.accept('siblings')) {
      s.expect('order'); s.expect('by');
      do { const e = parseExpr(s); const desc = !!s.accept('descending'); s.accept('ascending'); h.order.push({ e, desc }); } while (s.accept(','));
      continue;
    }
    if (s.accept('depth')) { h.depth = Number(s.next().v); continue; }
    s.next();   // period / multiple parents / orphans / cycles / generate spantree: accepted, defaults apply
  }
  s.expect(')');
  view.hierarchy = h;
  s.expect('{');
  while (!s.is('}')) {
    const el = parseElement(s, view);
    if (el) view.elements.push(el);
    if (!s.accept(',')) break;
  }
  s.expect('}');
  return view;
}

function parseView(s, ann, root, start) {
  const label = s.ident();
  const view = { kind: 'view', name: label.toLowerCase(), label, ann, root, joins: [], assocs: [], elements: [], line: start.line };
  if (s.accept('with')) { s.expect('parameters'); view.params = parseParams(s); }
  if (s.accept('provider')) { s.expect('contract'); view.contract = s.ident().toLowerCase(); }
  s.expect('as');
  if (s.accept('projection')) {
    s.expect('on');
    view.projection = true;
    view.from = parseSource(s);
  } else {
    s.expect('select');
    if (s.accept('distinct')) view.distinct = true;
    s.expect('from');
    view.from = parseSource(s);
    for (;;) {
      let type = null;
      if (s.acceptSeq('left', 'outer', 'join') || s.acceptSeq('left', 'join')) type = 'LEFT JOIN';
      else if (s.acceptSeq('inner', 'join') || s.accept('join')) type = 'INNER JOIN';
      else if (s.acceptSeq('cross', 'join')) type = 'CROSS JOIN';
      else if (s.acceptSeq('right', 'outer', 'join')) s.fail('RIGHT OUTER JOIN is not supported');
      if (!type) break;
      const src = parseSource(s);
      let on = null;
      if (s.accept('on')) on = parseExpr(s);
      view.joins.push({ type, ...src, on });
    }
  }
  // association / composition definitions
  for (;;) {
    if (s.is('association')) {
      s.next();
      const card = s.is('[') ? parseCard(s) : null;
      s.expect('to');
      const toParent = !!s.accept('parent');
      const target = s.ident();
      s.expect('as');
      const alias = s.ident();
      s.expect('on');
      const on = parseExpr(s);
      if (s.acceptSeq('with', 'default', 'filter')) parseExpr(s);
      view.assocs.push({ name: alias.toLowerCase(), label: alias, target: target.toLowerCase(), card, toParent, on });
    } else if (s.is('composition')) {
      s.next();
      const card = s.is('[') ? parseCard(s) : null;
      s.expect('of');
      const target = s.ident();
      s.expect('as');
      const alias = s.ident();
      view.assocs.push({ name: alias.toLowerCase(), label: alias, target: target.toLowerCase(), card, composition: true });
    } else break;
  }
  s.expect('{');
  while (!s.is('}')) {
    const el = parseElement(s, view);
    if (el) view.elements.push(el);
    if (!s.accept(',')) break;
  }
  s.expect('}');
  if (s.accept('where')) view.where = parseExpr(s);
  if (s.acceptSeq('group', 'by')) {
    view.groupBy = [parseExpr(s)];
    while (s.accept(',')) view.groupBy.push(parseExpr(s));
  }
  if (s.accept('having')) view.having = parseExpr(s);
  if (s.is('union')) s.fail('UNION is not supported yet');
  return view;
}

function parseCard(s) {
  s.expect('[');
  const parts = [];
  while (!s.is(']')) parts.push(s.next().v);
  s.expect(']');
  const txt = parts.join('');
  const [min, max] = txt.includes('..') ? txt.split('..') : [txt === '*' ? '0' : txt, txt];
  return { min: min === '*' ? 0 : Number(min), max: max === '*' ? '*' : Number(max) };
}

function parseSource(s) {
  const name = s.ident();
  // parameter bindings of a view / table function with parameters: ZI_X( p_a : $parameters.p_b, p_c : 'X' )
  let params = null;
  if (s.is('(')) {
    s.next();
    params = [];
    while (!s.is(')')) {
      const pn = s.ident();
      s.expect(':');
      params.push({ name: pn.toLowerCase(), expr: parseExpr(s) });
      if (!s.accept(',')) break;
    }
    s.expect(')');
  }
  let alias = null;
  if (s.accept('as')) alias = s.ident();
  return { name: name.toLowerCase(), label: name, alias: alias ? alias.toLowerCase() : null, ...(params ? { params } : {}) };
}

function parseElement(s, view) {
  const ann = parseAnnotations(s);
  if (s.is('}')) return null;
  const tok = s.peek();
  const key = !!s.accept('key');
  if (s.accept('virtual')) {
    const name = s.ident();
    s.expect(':');
    const type = parseType(s);
    return { name: name.toLowerCase(), label: name, key, virtual: true, type, ann };
  }
  const expr = parseExpr(s);
  let label = null;
  if (s.accept('as')) label = s.ident();
  if (s.accept(':')) {
    // _Assoc : redirected to [composition child | parent] Target   |   field : localized
    if (s.accept('localized')) { /* ignore */ }
    else {
      s.expect('redirected'); s.expect('to');
      let kind = 'assoc';
      if (s.acceptSeq('composition', 'child')) kind = 'child';
      else if (s.accept('parent')) kind = 'parent';
      const target = s.ident();
      const name = label || expr.path[expr.path.length - 1];
      return { name: name.toLowerCase(), label: name, assocRef: expr.path.join('.').toLowerCase(), redirect: { kind, target: target.toLowerCase() }, ann, line: tok.line };
    }
  }
  if (!label) {
    if (expr.k !== 'path') s.fail('Calculated element needs an alias (AS name)', tok);
    label = expr.path[expr.path.length - 1];
  }
  const el = { name: label.toLowerCase(), label, key, expr, ann, line: tok.line };
  // exposing an association (_Booking) rather than a column
  if (expr.k === 'path' && expr.path.length === 1 && view.assocs.some(a => a.name === expr.path[0].toLowerCase())) {
    el.assocRef = expr.path[0].toLowerCase();
    delete el.expr;
  } else if (expr.k === 'path' && expr.path.length === 1 && view.projection && expr.path[0].startsWith('_')) {
    el.assocRef = expr.path[0].toLowerCase();
    delete el.expr;
  }
  return el;
}

// ---------- metadata extension ----------
function parseAnnotate(s, ann) {
  s.expect('annotate');
  if (!s.accept('entity')) s.expect('view');
  const target = s.ident();
  s.expect('with');
  if (s.accept('parameters')) s.fail('Parameter annotations are not supported');
  s.expect('{');
  const elements = {};
  while (!s.is('}')) {
    const eann = parseAnnotations(s);
    if (s.is('}')) break;
    const name = s.ident();
    s.expect(';');
    elements[name.toLowerCase()] = eann;
  }
  s.expect('}');
  return { kind: 'ddlx', name: target.toLowerCase() + '#ddlx', target: target.toLowerCase(), ann, elements };
}

// ---------- expressions ----------
// AST: {k:'lit',v} {k:'path',path:[...]} {k:'fn',name,args} {k:'cast',e,type}
//      {k:'case',base,whens:[[w,t]],else} {k:'bin',op,l,r} {k:'not',e} {k:'isnull',e,neg}
//      {k:'between',e,lo,hi,neg} {k:'like',e,p,neg} {k:'in',e,list,neg} {k:'neg',e}
export function parseExpr(s) { return parseOr(s); }
function parseOr(s) {
  let l = parseAnd(s);
  while (s.accept('or')) l = { k: 'bin', op: 'OR', l, r: parseAnd(s) };
  return l;
}
function parseAnd(s) {
  let l = parseNot(s);
  while (s.accept('and')) l = { k: 'bin', op: 'AND', l, r: parseNot(s) };
  return l;
}
function parseNot(s) {
  if (s.accept('not')) return { k: 'not', e: parseNot(s) };
  return parseCmp(s);
}
function parseCmp(s) {
  const l = parseAdd(s);
  for (const op of ['=', '<>', '!=', '<=', '>=', '<', '>']) {
    if (s.is(op)) { s.next(); return { k: 'bin', op: op === '!=' ? '<>' : op, l, r: parseAdd(s) }; }
  }
  if (s.is('is')) {
    s.next();
    const neg = !!s.accept('not');
    if (s.accept('initial')) return { k: 'isinitial', e: l, neg };
    s.expect('null');
    return { k: 'isnull', e: l, neg };
  }
  const neg = s.is('not') && (s.is('like', 1) || s.is('between', 1) || s.is('in', 1)) ? !!s.next() : false;
  if (s.accept('like')) return { k: 'like', e: l, p: parseAdd(s), neg };
  if (s.accept('between')) {
    const lo = parseAdd(s); s.expect('and'); const hi = parseAdd(s);
    return { k: 'between', e: l, lo, hi, neg };
  }
  if (s.accept('in')) {
    s.expect('(');
    const list = [parseAdd(s)];
    while (s.accept(',')) list.push(parseAdd(s));
    s.expect(')');
    return { k: 'in', e: l, list, neg };
  }
  return l;
}
function parseAdd(s) {
  let l = parseMul(s);
  while (s.is('+') || s.is('-')) { const op = s.next().v; l = { k: 'bin', op, l, r: parseMul(s) }; }
  return l;
}
function parseMul(s) {
  let l = parseUnary(s);
  while (s.is('*') || s.is('/')) { const op = s.next().v; l = { k: 'bin', op, l, r: parseUnary(s) }; }
  return l;
}
function parseUnary(s) {
  if (s.accept('-')) return { k: 'neg', e: parseUnary(s) };
  return parsePrimary(s);
}
function parsePrimary(s) {
  const t = s.peek();
  if (t.t === 'str') { s.next(); return { k: 'lit', v: t.v }; }
  if (t.t === 'num') { s.next(); return { k: 'lit', v: Number(t.v) }; }
  if (s.accept('#')) return { k: 'lit', v: s.ident() };
  if (s.accept('(')) { const e = parseExpr(s); s.expect(')'); return e; }
  if (s.is('case')) {
    s.next();
    const node = { k: 'case', base: null, whens: [], else: null };
    if (!s.is('when')) node.base = parseExpr(s);
    while (s.accept('when')) { const w = parseExpr(s); s.expect('then'); node.whens.push([w, parseExpr(s)]); }
    if (s.accept('else')) node.else = parseExpr(s);
    s.expect('end');
    return node;
  }
  if (s.is('cast') && s.is('(', 1)) {
    s.next(); s.next();
    const e = parseExpr(s);
    s.expect('as');
    const type = parseType(s);
    if (s.acceptSeq('preserving', 'type')) { /* ignore */ }
    s.expect(')');
    return { k: 'cast', e, type };
  }
  if (t.t === 'id' && t.v.toLowerCase() === 'abap' && s.is('.', 1) && (s.peek(3).t === 'str' || s.peek(3).t === 'num')) {
    s.next(); s.next();
    const tname = s.ident();
    const lit = s.next();
    const v = lit.t === 'num' ? Number(lit.v) : lit.v;
    return { k: 'cast', e: { k: 'lit', v: /^(int|dec|fltp|curr|quan|decfloat)/.test(tname.toLowerCase()) ? Number(v) : v }, type: { name: 'abap.' + tname.toLowerCase() } };
  }
  if (t.t === 'id') {
    const name = s.next().v;
    if (s.is('(')) {
      s.next();
      const args = [];
      let distinct = false;
      if (s.accept('distinct')) distinct = true;
      else s.accept('all');
      if (s.is('*')) { s.next(); s.expect(')'); return { k: 'fn', name: name.toLowerCase(), args: [], star: true }; }
      const named = {};
      while (!s.is(')')) {
        if (s.peek().t === 'id' && s.is('=>', 1)) { const n = s.next().v.toLowerCase(); s.next(); named[n] = parseExpr(s); if (!s.accept(',')) break; continue; }
        let a = parseExpr(s);
        if (s.accept('as')) a = { k: 'cast', e: a, type: parseType(s) };
        args.push(a);
        if (!s.accept(',')) break;
      }
      s.expect(')');
      return { k: 'fn', name: name.toLowerCase(), args, distinct, named };
    }
    const path = [name];
    const filters = {};
    const filter = () => {
      if (!s.is('[')) return;
      s.next();
      if (s.peek().t === 'num' && s.is(':', 1)) { s.next(); s.next(); }
      if (s.isSeq('inner') || s.isSeq('left')) { while (!s.is('where') && !s.is(']')) s.next(); s.accept('where'); }
      if (!s.is(']')) filters[path.length - 1] = parseExpr(s);
      s.expect(']');
    };
    filter();
    while (s.is('.')) { s.next(); path.push(s.ident()); filter(); }
    return Object.keys(filters).length ? { k: 'path', path, filters } : { k: 'path', path };
  }
  s.fail(`Unexpected '${t.v}' in expression`);
}
