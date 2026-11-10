// CALL TRANSFORMATION with XSLT programs and Simple Transformations (ST), stored like abapGit does in
// src/<name>.xslt.source.xml. XSLT 1.0 (templates, apply-templates, call-template, for-each, sort, if, choose,
// variables/params, value-of, copy(-of), element/attribute, AVTs) with an XPath 1.0 evaluator; ST serialization
// and deserialization (tt:root, tt:template, tt:value, tt:attribute, tt:loop, tt:cond, tt:ref, tt:apply, tt:text).
// ABAP data enters XSLT as its asXML representation, exactly as on an SAP system.

// ---------------------------------------------------------------- XML DOM
export function parseXml(text) {
  const doc = { type: 'root', children: [], parent: null };
  const stack = [doc];
  const re = /<!--([\s\S]*?)-->|<!\[CDATA\[([\s\S]*?)\]\]>|<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>|<\/([^\s>]+)\s*>|<([^\s/>]+)((?:\s+[^\s=/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
  let m;
  while ((m = re.exec(text))) {
    const top = stack[stack.length - 1];
    if (m[1] !== undefined) top.children.push({ type: 'comment', value: m[1], parent: top });
    else if (m[2] !== undefined) top.children.push({ type: 'text', value: m[2], parent: top });
    else if (m[3]) stack.pop();
    else if (m[4]) {
      const el = { type: 'element', name: m[4], attrs: [], children: [], parent: top };
      for (const a of m[5].matchAll(/([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) el.attrs.push({ type: 'attribute', name: a[1], value: unesc(a[2] ?? a[3]), parent: el });
      top.children.push(el);
      if (!m[6]) stack.push(el);
    } else if (m[7] !== undefined) top.children.push({ type: 'text', value: unesc(m[7]), parent: top });
  }
  return doc;
}
const unesc = s => s.replace(/&(lt|gt|amp|quot|apos|#\d+|#x[0-9a-f]+);/gi, (x, e) => ({ lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" })[e.toLowerCase()] ?? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)));
const escText = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escAttr = s => escText(s).replace(/"/g, '&quot;');
export function serialize(node) {
  if (node.type === 'root') return node.children.map(serialize).join('');
  if (node.type === 'text') return escText(node.value);
  if (node.type === 'comment') return `<!--${node.value}-->`;
  if (node.type === 'attribute') return '';
  const attrs = node.attrs.map(a => ` ${a.name}="${escAttr(a.value)}"`).join('');
  return node.children.length ? `<${node.name}${attrs}>${node.children.map(serialize).join('')}</${node.name}>` : `<${node.name}${attrs}/>`;
}
const local = n => String(n).replace(/^.*:/, '');
const attr = (el, n) => el.attrs?.find(a => a.name === n)?.value;
function stringValue(n) {
  if (n == null) return '';
  if (n.type === 'text' || n.type === 'attribute' || n.type === 'comment') return n.value;
  return (n.children || []).map(c => (c.type === 'comment' ? '' : stringValue(c))).join('');
}

// ---------------------------------------------------------------- XPath 1.0
function tokenizeXPath(s) {
  const out = [];
  const re = /\s*(\$[\w.-]+(?::[\w.-]+)?|"[^"]*"|'[^']*'|\d+(?:\.\d+)?|\.\d+|\/\/|\/|\.\.|\.|::|@|\[|\]|\(|\)|,|\||!=|<=|>=|=|<|>|\+|-|\*|[A-Za-z_][\w.-]*(?::(?:[A-Za-z_][\w.-]*|\*))?)/y;
  let m;
  re.lastIndex = 0;
  while (re.lastIndex < s.length) {
    const at = re.lastIndex;
    m = re.exec(s);
    if (!m) { if (/^\s*$/.test(s.slice(at))) break; throw new Error(`XPath: cannot read '${s.slice(at)}'`); }
    out.push(m[1]);
  }
  return out;
}
class XPath {
  constructor(src) { this.t = tokenizeXPath(src); this.i = 0; this.ast = this.or(); if (this.i < this.t.length) throw new Error(`XPath: unexpected '${this.t[this.i]}' in ${src}`); }
  peek(k = 0) { return this.t[this.i + k]; }
  next() { return this.t[this.i++]; }
  bin(sub, ops) { let l = sub(); while (ops.includes(this.peek())) { const op = this.next(); l = { k: 'bin', op, l, r: sub() }; } return l; }
  or() { return this.bin(() => this.and(), ['or']); }
  and() { return this.bin(() => this.eq(), ['and']); }
  eq() { return this.bin(() => this.rel(), ['=', '!=']); }
  rel() { return this.bin(() => this.add(), ['<', '<=', '>', '>=']); }
  add() { return this.bin(() => this.mul(), ['+', '-']); }
  mul() {
    let l = this.unary();
    // '*' is multiplication only after an operand
    while (['*', 'div', 'mod'].includes(this.peek())) { const op = this.next(); l = { k: 'bin', op, l, r: this.unary() }; }
    return l;
  }
  unary() { if (this.peek() === '-') { this.next(); return { k: 'neg', e: this.unary() }; } return this.union(); }
  union() { let l = this.path(); while (this.peek() === '|') { this.next(); l = { k: 'union', l, r: this.path() }; } return l; }
  path() {
    const t = this.peek();
    if (t === '/' || t === '//') {
      this.next();
      const steps = t === '//' ? [{ axis: 'descendant-or-self', test: 'node()', preds: [] }] : [];
      if (this.isStepStart()) steps.push(...this.relSteps());
      return { k: 'path', abs: true, steps };
    }
    if (this.isStepStart() && !this.isFunctionCall()) return { k: 'path', abs: false, steps: this.relSteps() };
    let e = this.primary();
    while (this.peek() === '[') { this.next(); e = { k: 'filter', e, pred: this.or() }; this.expect(']'); }
    if (this.peek() === '/' || this.peek() === '//') {
      const sep = this.next();
      const steps = sep === '//' ? [{ axis: 'descendant-or-self', test: 'node()', preds: [] }] : [];
      steps.push(...this.relSteps());
      return { k: 'path', base: e, steps };
    }
    return e;
  }
  isFunctionCall() { const t = this.peek(); return /^[A-Za-z_][\w.-]*(:[\w.-]+)?$/.test(t) && this.peek(1) === '(' && !['node', 'text', 'comment', 'processing-instruction'].includes(t); }
  isStepStart() { const t = this.peek(); return t !== undefined && (t === '.' || t === '..' || t === '@' || t === '*' || /^[A-Za-z_]/.test(t)) && !['and', 'or', 'div', 'mod'].includes(t) || false; }
  relSteps() {
    const steps = [this.step()];
    while (this.peek() === '/' || this.peek() === '//') {
      if (this.next() === '//') steps.push({ axis: 'descendant-or-self', test: 'node()', preds: [] });
      steps.push(this.step());
    }
    return steps;
  }
  step() {
    let t = this.next();
    if (t === '.') return { axis: 'self', test: 'node()', preds: [] };
    if (t === '..') return { axis: 'parent', test: 'node()', preds: [] };
    let axis = 'child';
    if (t === '@') { axis = 'attribute'; t = this.next(); }
    else if (this.peek() === '::') { axis = t; this.next(); t = this.next(); }
    let test = t;
    if (this.peek() === '(' && ['node', 'text', 'comment', 'processing-instruction'].includes(t)) { this.next(); this.expect(')'); test = `${t}()`; }
    const preds = [];
    while (this.peek() === '[') { this.next(); preds.push(this.or()); this.expect(']'); }
    return { axis, test, preds };
  }
  primary() {
    const t = this.next();
    if (t === undefined) throw new Error('XPath: unexpected end');
    if (t === '(') { const e = this.or(); this.expect(')'); return e; }
    if (t[0] === '$') return { k: 'var', name: t.slice(1) };
    if (t[0] === '"' || t[0] === "'") return { k: 'lit', v: t.slice(1, -1) };
    if (/^\.?\d/.test(t)) return { k: 'num', v: Number(t) };
    if (this.peek() === '(') {
      this.next();
      const args = [];
      if (this.peek() !== ')') { do args.push(this.or()); while (this.peek() === ',' && this.next()); }
      this.expect(')');
      return { k: 'fn', name: t, args };
    }
    throw new Error(`XPath: unexpected '${t}'`);
  }
  expect(t) { if (this.next() !== t) throw new Error(`XPath: expected '${t}'`); }
}
const xpCache = new Map();
const compileXPath = src => { if (!xpCache.has(src)) xpCache.set(src, new XPath(src).ast); return xpCache.get(src); };

function docOrder(nodes) {
  const all = [];
  const root = nodes[0] && rootOf(nodes[0]);
  if (!root) return nodes;
  const index = new Map();
  const walk = n => { index.set(n, all.length); all.push(n); for (const a of n.attrs || []) { index.set(a, all.length); all.push(a); } for (const c of n.children || []) walk(c); };
  walk(root);
  return [...new Set(nodes)].sort((a, b) => (index.get(a) ?? 0) - (index.get(b) ?? 0));
}
const rootOf = n => { while (n.parent) n = n.parent; return n; };
function axisNodes(n, axis) {
  const kids = x => x.children || [];
  const desc = (x, out = []) => { for (const c of kids(x)) { out.push(c); desc(c, out); } return out; };
  switch (axis) {
    case 'child': return kids(n);
    case 'attribute': return n.attrs || [];
    case 'self': return [n];
    case 'parent': return n.parent ? [n.parent] : [];
    case 'descendant': return desc(n);
    case 'descendant-or-self': return [n, ...desc(n)];
    case 'ancestor': { const o = []; let p = n.parent; while (p) { o.push(p); p = p.parent; } return o; }
    case 'ancestor-or-self': { const o = [n]; let p = n.parent; while (p) { o.push(p); p = p.parent; } return o; }
    case 'following-sibling': { const s = n.parent ? kids(n.parent) : []; return s.slice(s.indexOf(n) + 1); }
    case 'preceding-sibling': { const s = n.parent ? kids(n.parent) : []; return s.slice(0, s.indexOf(n)).reverse(); }
    default: throw new Error(`XPath axis ${axis} is not supported`);
  }
}
function testNode(n, test, axis) {
  if (test === 'node()') return true;
  if (test === 'text()') return n.type === 'text';
  if (test === 'comment()') return n.type === 'comment';
  const principal = axis === 'attribute' ? 'attribute' : 'element';
  if (n.type !== principal) return false;
  if (test === '*') return true;
  if (test.endsWith(':*')) return n.name.startsWith(test.slice(0, -1));
  return n.name === test || (test.includes(':') ? local(n.name) === local(test) && !n.name.includes(':') : n.name === test);
}
const toStr = v => (Array.isArray(v) ? stringValue(v[0]) : typeof v === 'number' ? (Number.isInteger(v) ? String(v) : String(v)) : typeof v === 'boolean' ? String(v) : String(v ?? ''));
const toNum = v => { const s = toStr(v).trim(); return s === '' ? NaN : Number(s); };
const toBool = v => (Array.isArray(v) ? v.length > 0 : typeof v === 'number' ? v !== 0 && !isNaN(v) : typeof v === 'boolean' ? v : String(v).length > 0);

export function evalXPath(src, ctx) { return ev(typeof src === 'string' ? compileXPath(src) : src, ctx); }
function ev(x, c) {
  switch (x.k) {
    case 'lit': return x.v;
    case 'num': return x.v;
    case 'var': { if (!(x.name in c.vars)) throw new Error(`XPath: variable $${x.name} is not defined`); return c.vars[x.name]; }
    case 'neg': return -toNum(ev(x.e, c));
    case 'union': return docOrder([...ev(x.l, c), ...ev(x.r, c)]);
    case 'filter': { let ns = ev(x.e, c); return applyPred(ns, x.pred, c); }
    case 'path': {
      let ns = x.base ? ev(x.base, c) : x.abs ? [rootOf(c.node)] : [c.node];
      for (const st of x.steps) {
        const next = [];
        for (const n of ns) {
          let cand = axisNodes(n, st.axis).filter(m => testNode(m, st.test, st.axis));
          for (const p of st.preds) cand = applyPred(cand, p, c);
          next.push(...cand);
        }
        ns = docOrder(next);
      }
      return ns;
    }
    case 'bin': {
      const { op } = x;
      if (op === 'or') return toBool(ev(x.l, c)) || toBool(ev(x.r, c));
      if (op === 'and') return toBool(ev(x.l, c)) && toBool(ev(x.r, c));
      const l = ev(x.l, c), r = ev(x.r, c);
      if (['=', '!=', '<', '<=', '>', '>='].includes(op)) return compare(op, l, r);
      const a = toNum(l), b = toNum(r);
      return op === '+' ? a + b : op === '-' ? a - b : op === '*' ? a * b : op === 'div' ? a / b : a % b;
    }
    case 'fn': return callFn(x.name, x.args, c);
  }
  throw new Error(`XPath: ${x.k}`);
}
function applyPred(ns, pred, c) {
  return ns.filter((n, i) => {
    const v = ev(pred, { ...c, node: n, pos: i + 1, size: ns.length });
    return typeof v === 'number' ? v === i + 1 : toBool(v);
  });
}
function compare(op, l, r) {
  const cmp = (a, b) => {
    if (op === '=' || op === '!=') {
      const eq = typeof a === 'number' || typeof b === 'number' ? toNum(a) === toNum(b) : typeof a === 'boolean' || typeof b === 'boolean' ? toBool(a) === toBool(b) : String(a) === String(b);
      return op === '=' ? eq : !eq;
    }
    const x = toNum(a), y = toNum(b);
    return op === '<' ? x < y : op === '<=' ? x <= y : op === '>' ? x > y : x >= y;
  };
  const vals = v => (Array.isArray(v) ? v.map(stringValue) : [v]);
  for (const a of vals(l)) for (const b of vals(r)) if (cmp(a, b)) return true;
  return false;
}
function callFn(name, args, c) {
  const a = i => ev(args[i], c);
  const s = i => (args[i] === undefined ? stringValue(c.node) : toStr(a(i)));
  switch (local(name)) {
    case 'last': return c.size ?? 1;
    case 'position': return c.pos ?? 1;
    case 'count': return a(0).length;
    case 'name': { const n = args.length ? a(0)[0] : c.node; return n?.name || ''; }
    case 'local-name': { const n = args.length ? a(0)[0] : c.node; return n?.name ? local(n.name) : ''; }
    case 'string': return s(0);
    case 'concat': return args.map((_, i) => toStr(a(i))).join('');
    case 'starts-with': return s(0).startsWith(s(1));
    case 'ends-with': return s(0).endsWith(s(1));
    case 'contains': return s(0).includes(s(1));
    case 'substring': { const str = s(0); const st = Math.round(toNum(a(1))); const len = args[2] ? Math.round(toNum(a(2))) : Infinity; return [...str].filter((_, i) => i + 1 >= st && i + 1 < st + len).join(''); }
    case 'substring-before': { const str = s(0), sub = s(1); const i = str.indexOf(sub); return i < 0 ? '' : str.slice(0, i); }
    case 'substring-after': { const str = s(0), sub = s(1); const i = str.indexOf(sub); return i < 0 ? '' : str.slice(i + sub.length); }
    case 'string-length': return s(0).length;
    case 'normalize-space': return s(0).trim().replace(/\s+/g, ' ');
    case 'translate': { const f = s(1), t = s(2); return [...s(0)].map(ch => { const i = f.indexOf(ch); return i < 0 ? ch : (t[i] ?? ''); }).join(''); }
    case 'upper-case': return s(0).toUpperCase();
    case 'lower-case': return s(0).toLowerCase();
    case 'boolean': return toBool(a(0));
    case 'not': return !toBool(a(0));
    case 'true': return true;
    case 'false': return false;
    case 'number': return args.length ? toNum(a(0)) : toNum([c.node]);
    case 'sum': return a(0).reduce((x, n) => x + toNum(stringValue(n)), 0);
    case 'floor': return Math.floor(toNum(a(0)));
    case 'ceiling': return Math.ceil(toNum(a(0)));
    case 'round': return Math.round(toNum(a(0)));
    case 'current': return [c.current || c.node];
    case 'format-number': { const n = toNum(a(0)); const dec = (s(1).split('.')[1] || '').replace(/[^0#]/g, '').length; return n.toFixed(dec); }
    default: throw new Error(`XPath function ${name}() is not supported`);
  }
}

// ---------------------------------------------------------------- XSLT 1.0
const XSL = n => n.type === 'element' && /^xsl:/.test(n.name);
export function runXslt(styleText, inputDoc, params = {}) {
  const sheet = parseXml(styleText).children.find(n => n.type === 'element');
  if (!sheet || !/^(xsl:)?(stylesheet|transform)$/.test(sheet.name)) throw new Error('Not an XSLT stylesheet');
  const templates = [], named = new Map(), globals = [];
  let output = { method: 'xml', omitDecl: false };
  for (const n of sheet.children.filter(x => x.type === 'element')) {
    if (n.name === 'xsl:template') {
      if (attr(n, 'name')) named.set(attr(n, 'name'), n);
      if (attr(n, 'match')) for (const pat of attr(n, 'match').split('|')) templates.push({ node: n, pattern: pat.trim(), mode: attr(n, 'mode') || '', priority: attr(n, 'priority') !== undefined ? Number(attr(n, 'priority')) : defaultPriority(pat.trim()), order: templates.length });
    } else if (n.name === 'xsl:output') output = { method: attr(n, 'method') || 'xml', omitDecl: attr(n, 'omit-xml-declaration') === 'yes' };
    else if (n.name === 'xsl:variable' || n.name === 'xsl:param') globals.push(n);
  }
  const vars = {};
  const rootCtx = { node: inputDoc, vars, pos: 1, size: 1 };
  for (const g of globals) vars[attr(g, 'name')] = g.name === 'xsl:param' && attr(g, 'name') in params ? params[attr(g, 'name')] : varValue(g, rootCtx);
  const result = { type: 'root', children: [], parent: null };
  applyTemplates([inputDoc], '', rootCtx, result);
  const text = output.method === 'text' ? stringValue(result) : (output.omitDecl || output.method === 'html' ? '' : '<?xml version="1.0" encoding="utf-8"?>') + serialize(result);
  return { text, doc: result, method: output.method };

  function matches(n, pattern, c) {
    if (pattern === '/') return n.type === 'root';
    // pattern p1/p2/p3: the last step tests the node, earlier steps its ancestors
    const steps = pattern.replace(/^\/\//, '').split(/(?<!\/)\/(?!\/)/);
    const abs = pattern.startsWith('/') && !pattern.startsWith('//');
    let cur = n;
    for (let i = steps.length - 1; i >= 0; i--) {
      const stp = steps[i];
      if (stp === '') return cur.type === 'root';
      if (!cur) return false;
      const m = /^(@)?([^[]+)((?:\[.*\])*)$/.exec(stp.replace(/^child::/, ''));
      if (!m) return false;
      const isAttr = !!m[1], test = m[2];
      if (!testNode(cur, test === 'node()' || test === 'text()' || test === 'comment()' ? test : test, isAttr ? 'attribute' : 'child')) return false;
      if (m[3]) {
        const sibs = (cur.parent?.children || []).filter(x => testNode(x, test, isAttr ? 'attribute' : 'child'));
        for (const p of m[3].match(/\[(.*?)\](?=\[|$)/g) || []) {
          const v = evalXPath(p.slice(1, -1), { ...c, node: cur, pos: sibs.indexOf(cur) + 1, size: sibs.length });
          if (typeof v === 'number' ? v !== sibs.indexOf(cur) + 1 : !toBool(v)) return false;
        }
      }
      cur = cur.parent;
    }
    return !abs || cur?.type === 'root';
  }
  function applyTemplates(nodes, mode, c, out) {
    nodes.forEach((n, i) => {
      const ctx = { ...c, node: n, pos: i + 1, size: nodes.length, current: n };
      const t = templates.filter(t => t.mode === mode && matches(n, t.pattern, ctx)).sort((a, b) => b.priority - a.priority || b.order - a.order)[0];
      if (t) return instantiate(t.node.children, { ...ctx, vars: { ...c.vars } }, out);
      // built-in rules
      if (n.type === 'root' || n.type === 'element') applyTemplates(n.children.filter(x => x.type !== 'comment'), mode, ctx, out);
      else if (n.type === 'text' || n.type === 'attribute') addText(out, n.value);
    });
  }
  function addText(out, v) {
    if (v === '') return;
    const last = out.children[out.children.length - 1];
    if (last?.type === 'text') last.value += v; else out.children.push({ type: 'text', value: v, parent: out });
  }
  function avt(s, c) { return String(s ?? '').replace(/\{\{|\}\}|\{([^}]*)\}/g, (m, e) => (m === '{{' ? '{' : m === '}}' ? '}' : toStr(evalXPath(e, c)))); }
  function varValue(n, c) {
    if (attr(n, 'select') !== undefined) return evalXPath(attr(n, 'select'), c);
    const frag = { type: 'root', children: [], parent: null };
    instantiate(n.children, c, frag);
    return frag.children.length ? [frag] : '';
  }
  function sortNodes(nodes, sorts, c) {
    if (!sorts.length) return nodes;
    const keys = nodes.map((n, i) => sorts.map(s => { const v = toStr(evalXPath(attr(s, 'select') || '.', { ...c, node: n, pos: i + 1, size: nodes.length })); return attr(s, 'data-type') === 'number' ? Number(v) : v; }));
    const idx = nodes.map((_, i) => i).sort((a, b) => {
      for (let k = 0; k < sorts.length; k++) {
        const x = keys[a][k], y = keys[b][k];
        const r = typeof x === 'number' ? x - y : String(x).localeCompare(String(y));
        if (r) return attr(sorts[k], 'order') === 'descending' ? -r : r;
      }
      return a - b;
    });
    return idx.map(i => nodes[i]);
  }
  function instantiate(nodes, c, out) {
    const vars = { ...c.vars };
    for (const n of nodes) {
      const ctx = { ...c, vars };
      if (n.type === 'text') { if (n.value.trim() || out.preserve) addText(out, n.value); continue; }
      if (n.type !== 'element') continue;
      if (!XSL(n)) {
        const el = { type: 'element', name: n.name, attrs: n.attrs.filter(a => !/^xmlns:xsl$/.test(a.name)).map(a => ({ type: 'attribute', name: a.name, value: avt(a.value, ctx) })), children: [], parent: out };
        out.children.push(el);
        instantiate(n.children, ctx, el);
        continue;
      }
      switch (n.name) {
        case 'xsl:value-of': addText(out, toStr(evalXPath(attr(n, 'select'), ctx))); break;
        case 'xsl:text': addText(out, stringValue(n)); break;
        case 'xsl:variable': case 'xsl:param': if (!(n.name === 'xsl:param' && attr(n, 'name') in vars && c.withParams?.has(attr(n, 'name')))) vars[attr(n, 'name')] = varValue(n, ctx); break;
        case 'xsl:apply-templates': {
          let sel = attr(n, 'select') ? evalXPath(attr(n, 'select'), ctx) : (ctx.node.children || []).filter(x => x.type !== 'comment');
          sel = sortNodes(sel, n.children.filter(x => x.name === 'xsl:sort'), ctx);
          const wp = withParams(n, ctx);
          applyTemplates(sel, attr(n, 'mode') || '', { ...ctx, vars: { ...vars, ...wp.vals }, withParams: wp.names }, out);
          break;
        }
        case 'xsl:call-template': {
          const t = named.get(attr(n, 'name'));
          if (!t) throw new Error(`XSLT template ${attr(n, 'name')} not found`);
          const wp = withParams(n, ctx);
          instantiate(t.children, { ...ctx, vars: { ...vars, ...wp.vals }, withParams: wp.names }, out);
          break;
        }
        case 'xsl:for-each': {
          let sel = evalXPath(attr(n, 'select'), ctx);
          sel = sortNodes(sel, n.children.filter(x => x.name === 'xsl:sort'), ctx);
          sel.forEach((m, i) => instantiate(n.children.filter(x => x.name !== 'xsl:sort'), { ...ctx, node: m, pos: i + 1, size: sel.length, current: m }, out));
          break;
        }
        case 'xsl:if': if (toBool(evalXPath(attr(n, 'test'), ctx))) instantiate(n.children, ctx, out); break;
        case 'xsl:choose': {
          const when = n.children.find(w => w.name === 'xsl:when' && toBool(evalXPath(attr(w, 'test'), ctx))) || n.children.find(w => w.name === 'xsl:otherwise');
          if (when) instantiate(when.children, ctx, out);
          break;
        }
        case 'xsl:element': { const el = { type: 'element', name: avt(attr(n, 'name'), ctx), attrs: [], children: [], parent: out }; out.children.push(el); instantiate(n.children, ctx, el); break; }
        case 'xsl:attribute': { const tmp = { type: 'root', children: [], parent: null }; instantiate(n.children, ctx, tmp); const name = avt(attr(n, 'name'), ctx); (out.attrs ||= []).push({ type: 'attribute', name, value: attr(n, 'select') ? toStr(evalXPath(attr(n, 'select'), ctx)) : stringValue(tmp), parent: out }); break; }
        case 'xsl:comment': { const tmp = { type: 'root', children: [], parent: null }; instantiate(n.children, ctx, tmp); out.children.push({ type: 'comment', value: stringValue(tmp), parent: out }); break; }
        case 'xsl:copy': {
          const s = ctx.node;
          if (s.type === 'element') { const el = { type: 'element', name: s.name, attrs: [], children: [], parent: out }; out.children.push(el); instantiate(n.children, ctx, el); }
          else if (s.type === 'text') addText(out, s.value);
          else if (s.type === 'attribute') (out.attrs ||= []).push({ ...s, parent: out });
          else instantiate(n.children, ctx, out);
          break;
        }
        case 'xsl:copy-of': {
          const v = evalXPath(attr(n, 'select'), ctx);
          if (!Array.isArray(v)) { addText(out, toStr(v)); break; }
          for (const m of v) {
            if (m.type === 'attribute') (out.attrs ||= []).push({ ...m, parent: out });
            else if (m.type === 'root') for (const k of m.children) out.children.push(copyNode(k, out));
            else out.children.push(copyNode(m, out));
          }
          break;
        }
        case 'xsl:message': case 'xsl:sort': case 'xsl:strip-space': case 'xsl:preserve-space': case 'xsl:output': break;
        default: throw new Error(`${n.name} is not supported`);
      }
    }
  }
  function withParams(n, c) {
    const vals = {}, names = new Set();
    for (const p of n.children.filter(x => x.name === 'xsl:with-param')) { vals[attr(p, 'name')] = varValue(p, c); names.add(attr(p, 'name')); }
    return { vals, names };
  }
}
function copyNode(n, parent) {
  const c = { ...n, parent };
  if (n.attrs) c.attrs = n.attrs.map(a => ({ ...a, parent: c }));
  if (n.children) c.children = n.children.map(k => copyNode(k, c));
  return c;
}
function defaultPriority(p) {
  if (/[/[]/.test(p)) return 0.5;
  if (p === '*' || p === '@*' || p === 'node()' || p === 'text()') return -0.5;
  if (/:\*$/.test(p)) return -0.25;
  return 0;
}

// ---------------------------------------------------------------- Simple Transformations
const TT = n => n.type === 'element' && /^tt:/.test(n.name);
function stParts(text) {
  const tr = parseXml(text).children.find(n => n.type === 'element');
  if (!tr || local(tr.name) !== 'transform') throw new Error('Not a simple transformation');
  const roots = tr.children.filter(n => n.name === 'tt:root').map(n => attr(n, 'name'));
  const templates = new Map();
  let main = null;
  for (const t of tr.children.filter(n => n.name === 'tt:template')) { if (attr(t, 'name')) templates.set(attr(t, 'name'), t); else main = t; }
  if (!main) main = templates.get(attr(tr, 'template')) || [...templates.values()][0];
  return { roots, templates, main };
}
export const isSimpleTransformation = text => /<tt:transform\b/.test(text);
// reference resolution: ".ROOT" / "ROOT" (a root), "$var" (a loop variable), "a.b" components, "." current node
function resolveRef(ref, c) {
  let r = String(ref).trim();
  let base;
  if (r === '.') return c.cur;
  if (r.startsWith('$')) { const [v, ...rest] = r.slice(1).split('.'); base = c.vars[v.toLowerCase()]; r = rest.join('.'); }
  else if (r.startsWith('.')) { const [root, ...rest] = r.slice(1).split('.'); base = c.roots[root.toLowerCase()]; r = rest.join('.'); }
  else {
    const [first, ...rest] = r.split('.');
    if (first.toLowerCase() in c.roots && c.cur === undefined) { base = c.roots[first.toLowerCase()]; r = rest.join('.'); }
    else base = c.cur;
  }
  for (const k of r.split('.').filter(Boolean)) base = base?.[k.toLowerCase()];
  return base;
}
function setRef(ref, value, c) {
  const parts = String(ref).trim().replace(/^\./, '').split('.').filter(Boolean);
  let obj, path;
  if (parts[0]?.startsWith('$')) { obj = c.vars[parts[0].slice(1).toLowerCase()]; path = parts.slice(1); }
  else if (parts[0] && parts[0].toLowerCase() in c.roots && (String(ref).startsWith('.') || c.curPath === undefined)) { obj = c.roots; path = parts; }
  else { obj = c.cur; path = parts; }
  path = path.map(p => p.toLowerCase());
  for (let i = 0; i < path.length - 1; i++) { obj[path[i]] ??= {}; obj = obj[path[i]]; }
  if (path.length) obj[path[path.length - 1]] = value;
}
export function stSerialize(text, values) {
  const { roots, templates, main } = stParts(text);
  const rootVals = Object.fromEntries(roots.map(r => [r.toLowerCase(), values[r.toLowerCase()]]));
  const out = { type: 'root', children: [], parent: null };
  const run = (nodes, c, o) => {
    for (const n of nodes) {
      if (n.type === 'text') { if (n.value.trim()) o.children.push({ type: 'text', value: n.value, parent: o }); continue; }
      if (n.type !== 'element') continue;
      if (!TT(n)) {
        const el = { type: 'element', name: n.name, attrs: n.attrs.filter(a => !/^xmlns:tt$/.test(a.name)).map(a => ({ ...a })), children: [], parent: o };
        o.children.push(el);
        run(n.children, c, el);
        continue;
      }
      const ref = attr(n, 'ref');
      switch (n.name) {
        case 'tt:value': o.children.push({ type: 'text', value: fmt(resolveRef(ref ?? '.', c)), parent: o }); break;
        case 'tt:attribute': (o.attrs ||= []).push({ type: 'attribute', name: attr(n, 'name'), value: attr(n, 'value-ref') !== undefined ? fmt(resolveRef(attr(n, 'value-ref'), c)) : stringValue(n), parent: o }); break;
        case 'tt:text': o.children.push({ type: 'text', value: stringValue(n), parent: o }); break;
        case 'tt:loop': {
          const rows = resolveRef(ref, c) || [];
          const name = attr(n, 'name');
          for (const row of rows) run(n.children, { ...c, cur: row, vars: { ...c.vars, ...(name ? { [name.toLowerCase()]: row } : {}) } }, o);
          break;
        }
        case 'tt:ref': run(n.children, { ...c, cur: resolveRef(attr(n, 'name'), c) }, o); break;
        case 'tt:cond': case 'tt:s-cond': {
          const d = attr(n, 'data') || attr(n, 'check');
          if (!d || condTrue(d, c)) run(n.children, ref ? { ...c, cur: resolveRef(ref, c) } : c, o);
          break;
        }
        case 'tt:switch': { const hit = n.children.find(x => x.type === 'element' && (!(attr(x, 'data') || attr(x, 'check')) || condTrue(attr(x, 'data') || attr(x, 'check'), c))); if (hit) run(hit.children, c, o); break; }
        case 'tt:apply': { const t = templates.get(attr(n, 'name')); if (!t) throw new Error(`ST template ${attr(n, 'name')} not found`); run(t.children, ref ? { ...c, cur: resolveRef(ref, c) } : c, o); break; }
        case 'tt:copy': o.children.push(...parseXml(asXmlFragment(resolveRef(ref ?? '.', c))).children.map(x => ({ ...x, parent: o }))); break;
        case 'tt:context': case 'tt:parameter': case 'tt:variable': case 'tt:root': break;
        default: throw new Error(`${n.name} is not supported`);
      }
    }
  };
  run(main.children, { roots: rootVals, vars: {}, cur: undefined }, out);
  return '<?xml version="1.0" encoding="utf-8"?>' + serialize(out);
}
function condTrue(expr, c) {
  const m = /^\s*(not-)?(initial|exist|bound)\(\s*([^)]+)\)\s*$/.exec(expr);
  if (m) {
    const v = resolveRef(m[3], c);
    const r = m[2] === 'initial' ? v === undefined || v === null || v === '' || v === 0 || (Array.isArray(v) && !v.length) : v !== undefined && v !== null;
    return m[1] ? !r : r;
  }
  const cmp = /^\s*([$.\w]+)\s*=\s*'([^']*)'\s*$/.exec(expr);
  if (cmp) return String(resolveRef(cmp[1], c) ?? '') === cmp[2];
  throw new Error(`ST condition ${expr} is not supported`);
}
function fmt(v) { return v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v).replace(/ +$/, ''); }
function asXmlFragment(v) {
  if (Array.isArray(v)) return v.map(x => `<item>${asXmlFragment(x)}</item>`).join('');
  if (v && typeof v === 'object') return Object.entries(v).map(([k, x]) => `<${k.toUpperCase()}>${asXmlFragment(x)}</${k.toUpperCase()}>`).join('');
  return escText(v ?? '');
}
// deserialization: the template is matched against the document; tt:value / tt:attribute fill the data
export function stDeserialize(text, xml) {
  const { roots, templates, main } = stParts(text);
  const result = Object.fromEntries(roots.map(r => [r.toLowerCase(), undefined]));
  const doc = parseXml(xml);
  const elems = n => (n.children || []).filter(x => x.type === 'element');
  const match = (tnodes, xnode, c) => {
    let pos = 0;
    const xs = elems(xnode);
    for (const t of tnodes) {
      if (t.type !== 'element') continue;
      if (!TT(t)) {
        const x = xs[pos];
        if (!x || local(x.name) !== local(t.name)) throw new Error(`ST: expected element <${t.name}>${x ? ` but found <${x.name}>` : ''}`);
        pos++;
        match(t.children, x, c);
        continue;
      }
      const ref = attr(t, 'ref');
      switch (t.name) {
        case 'tt:value': setRef(ref ?? '.', stringValue(xnode).trim(), c); break;
        case 'tt:attribute': if (attr(t, 'value-ref') !== undefined) setRef(attr(t, 'value-ref'), attr(xnode, attr(t, 'name')) ?? '', c); break;
        case 'tt:loop': {
          // repeated elements matching the loop body's first literal element
          const first = t.children.find(x => x.type === 'element' && !TT(x));
          const rows = [];
          while (pos < xs.length && (!first || local(xs[pos].name) === local(first.name))) {
            const row = {};
            const name = attr(t, 'name');
            const fake = { type: 'root', children: [xs[pos]] };
            match(t.children, fake, { ...c, cur: row, curPath: 'row', vars: { ...c.vars, ...(name ? { [name.toLowerCase()]: row } : {}) } });
            rows.push(row);
            pos++;
            if (!first) break;
          }
          setRef(ref, rows, c);
          break;
        }
        case 'tt:ref': { const sub = {}; match(t.children, xnode, { ...c, cur: sub, curPath: 'ref' }); setRef(attr(t, 'name'), sub, c); break; }
        case 'tt:apply': match(templates.get(attr(t, 'name')).children, xnode, c); break;
        case 'tt:cond': case 'tt:s-cond': try { match(t.children, xnode, c); } catch { /* optional part */ } break;
        default: break;
      }
    }
  };
  match(main.children, doc, { roots: result, vars: {}, cur: undefined });
  return result;
}
