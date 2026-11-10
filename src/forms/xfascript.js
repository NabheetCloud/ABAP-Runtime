// Scripts of Adobe LiveCycle Designer layouts (XFA: JavaScript and FormCalc) converted into the expressions of a
// RAP Studio layout (script.js): calculations become calculated values ({= … }, "calc"), presence scripts become
// conditions ("if"). The script is executed symbolically: local variables, if / else (JavaScript) and if / then /
// elseif / else / endif (FormCalc), loops that add up the rows of a table (for … i < Row.all.length …), assignments to
// this.rawValue / $.rawValue / $ and to the presence of this or another object, the last expression as the value of a
// calculate script.
//
//   convertScript(src, { lang: 'js' | 'formcalc', self, ref }) ->
//     { value?: 'expr', visible?: 'expr', effects: [{ target, value?, visible? }], notes: [...] }
//   self: the object's name; ref(layoutPath) -> data path (layout objects -> bound data, rows -> tables)
// What cannot be expressed (other statements, functions, the event object, xfa.host dialogs) throws an Error with the
// reason; the importer reports it.

const KW_FC = new Set(['if', 'then', 'elseif', 'else', 'endif', 'var', 'for', 'upto', 'downto', 'step', 'do', 'endfor', 'while', 'endwhile', 'foreach', 'in', 'func', 'endfunc', 'return', 'and', 'or', 'not', 'eq', 'ne', 'lt', 'gt', 'le', 'ge', 'null', 'break', 'continue']);

function tokenize(src, fc) {
  const out = [];
  // FormCalc comments start with ; or //; JavaScript ends statements with ;
  const TOKENS = '(\\d+(?:\\.\\d+)?(?:[eE][+-]?\\d+)?|\\.\\d+)|("(?:[^"\\\\]|\\\\.|"")*"|\'(?:[^\'\\\\]|\\\\.)*\')|([A-Za-z_$][\\w$#]*)|(===|!==|==|!=|<>|<=|>=|&&|\\|\\||\\+\\+|--|\\+=|-=|\\*=|\\/=|[-+*/%<>=!?:(){}[\\],.;&|])';
  const rx = new RegExp(`\\s+|\\/\\/[^\\n]*|\\/\\*[\\s\\S]*?\\*\\/|${fc ? ';[^\\n]*|' : ''}${TOKENS}`, 'y');
  let m;
  while (rx.lastIndex < src.length) {
    const at = rx.lastIndex;
    if (!(m = rx.exec(src))) throw new Error(`cannot read the script at '${src.slice(at, at + 20)}'`);
    if (m[1] !== undefined) out.push({ k: 'num', v: Number(m[1]) });
    else if (m[2] !== undefined) { const q = m[2][0]; out.push({ k: 'str', v: m[2].slice(1, -1).replace(new RegExp(`${q}${q}`, 'g'), q).replace(/\\(.)/g, (a, c) => ({ n: '\n', t: '\t' }[c] ?? c)) }); }
    else if (m[3] !== undefined) out.push({ k: fc && KW_FC.has(m[3].toLowerCase()) ? 'kw' : 'id', v: fc && KW_FC.has(m[3].toLowerCase()) ? m[3].toLowerCase() : m[3] });
    else if (m[4] !== undefined) out.push({ k: 'op', v: m[4] });
  }
  return out;
}

// ------------------------------------------------------------------ parser (JavaScript and FormCalc)
function parse(src, fc) {
  const t = tokenize(src, fc);
  let i = 0;
  const peek = (o = 0) => t[i + o];
  const is = (...v) => t[i] && (t[i].k === 'op' || t[i].k === 'kw' || (t[i].k === 'id' && !fc)) && v.includes(t[i].v);
  const isKw = v => t[i] && (t[i].k === 'kw' || t[i].k === 'id') && String(t[i].v).toLowerCase() === v;
  const expect = v => { if (!(is(v) || isKw(v))) throw new Error(`expected '${v}' at '${t[i]?.v ?? 'the end'}'`); i++; };
  const bin = (sub, ops) => () => { let l = sub(); for (;;) { const tok = t[i]; if (!tok || !(tok.k === 'op' || tok.k === 'kw') || !ops.includes(tok.v)) return l; i++; l = { t: 'bin', op: tok.v, l, r: sub() }; } };
  const primary = () => {
    const tok = t[i++];
    if (!tok) throw new Error('incomplete expression');
    if (tok.k === 'num') return { t: 'num', v: tok.v };
    if (tok.k === 'str') return { t: 'str', v: tok.v };
    if (tok.k === 'op' && tok.v === '(') { const e = expr(); expect(')'); return e; }
    if (tok.k === 'kw' && tok.v === 'null') return { t: 'null' };
    if (tok.k === 'kw' && tok.v === 'if') { i--; return ifExpr(); }
    if (tok.k === 'id') {
      if (tok.v === 'null' || tok.v === 'undefined') return { t: 'null' };
      if (tok.v === 'true' || tok.v === 'false') return { t: 'bool', v: tok.v === 'true' };
      if (tok.v === 'new') throw new Error('objects (new …) cannot be converted');
      if (tok.v === 'function') throw new Error('functions cannot be converted');
      return { t: 'id', v: tok.v };
    }
    throw new Error(`unexpected '${tok.v}'`);
  };
  const postfix = () => {
    let e = primary();
    for (;;) {
      if (is('.')) { i++; const n = t[i++]; if (!n || (n.k !== 'id' && n.k !== 'kw')) throw new Error('a name is expected after .'); e = { t: 'member', o: e, name: n.v }; continue; }
      if (is('[')) { i++; const ix = is('*') ? (i++, { t: 'star' }) : expr(); expect(']'); e = { t: 'index', o: e, i: ix }; continue; }
      if (is('(')) { i++; const args = []; if (!is(')')) { args.push(expr()); while (is(',')) { i++; args.push(expr()); } } expect(')'); e = { t: 'call', f: e, args }; continue; }
      if (is('++', '--') && !fc) { const op = t[i++].v; e = { t: 'post', op, e }; continue; }
      return e;
    }
  };
  const unary = () => {
    if (is('-')) { i++; return { t: 'neg', e: unary() }; }
    if (is('+')) { i++; return unary(); }
    if (is('!') || (t[i]?.k === 'kw' && t[i].v === 'not')) { i++; return { t: 'not', e: unary() }; }
    if (!fc && is('typeof')) throw new Error('typeof cannot be converted');
    return postfix();
  };
  const mul = bin(unary, ['*', '/', '%']);
  const add = bin(mul, ['+', '-']);
  const rel = bin(add, ['<', '>', '<=', '>=', 'lt', 'gt', 'le', 'ge']);
  const eq = bin(rel, ['==', '===', '!=', '!==', '<>', 'eq', 'ne']);
  const and = bin(eq, ['&&', 'and', '&']);
  const or = bin(and, ['||', 'or', '|']);
  const ternary = () => { const c = or(); if (!fc && is('?')) { i++; const a = ternary(); expect(':'); const b = ternary(); return { t: 'cond', c, a, b }; } return c; };
  const assign = () => {
    const l = ternary();
    if (is('=', '+=', '-=', '*=', '/=')) { const op = t[i++].v; return { t: 'assign', op, l, r: assign() }; }
    return l;
  };
  function expr() { return assign(); }
  // FormCalc: if (c) then stmts [elseif (c) then stmts] [else stmts] endif (also usable as an expression)
  function ifExpr() {
    expect('if');
    const branches = [];
    const cond = () => { const c = ternary(); return c; };
    let c = cond(); expect('then');
    branches.push([c, stmts(['elseif', 'else', 'endif'])]);
    for (;;) {
      if (isKw('elseif')) { i++; c = cond(); expect('then'); branches.push([c, stmts(['elseif', 'else', 'endif'])]); continue; }
      let other = [];
      if (isKw('else')) { i++; other = stmts(['endif']); }
      expect('endif');
      return { t: 'if', branches, other };
    }
  }
  const block = () => { if (is('{')) { i++; const b = stmts(['}']); expect('}'); return b; } return [stmt()]; };
  function stmt() {
    while (is(';')) i++;
    if (!t[i]) return { t: 'empty' };
    if (fc ? isKw('var') : is('var', 'let', 'const')) {
      i++;
      const decls = [];
      do { const n = t[i++]; if (!n || n.k !== 'id') throw new Error('a variable name is expected'); decls.push({ t: 'expr', e: { t: 'assign', op: '=', l: { t: 'id', v: n.v }, r: is('=') ? (i++, ternary()) : { t: 'num', v: 0 }, decl: true } }); } while (is(',') && (i++, true));
      return { t: 'seq', body: decls };
    }
    if (isKw('if')) {
      if (fc) return ifExpr();
      i++; expect('('); const c = expr(); expect(')');
      const then = block();
      let other = [];
      if (isKw('else')) { i++; other = block(); }
      return { t: 'if', branches: [[c, then]], other };
    }
    if (!fc && isKw('for')) {
      i++; expect('(');
      const init = is(';') ? null : stmt(); expect(';');
      const cond = is(';') ? null : expr(); expect(';');
      const update = is(')') ? null : expr(); expect(')');
      return { t: 'for', init, cond, update, body: block() };
    }
    if (fc && isKw('for')) {
      i++;
      const v = t[i++].v; expect('=');
      const from = ternary();
      const dir = isKw('upto') ? 'upto' : 'downto'; i++;
      const to = ternary();
      let step = null; if (isKw('step')) { i++; step = ternary(); }
      expect('do'); const body = stmts(['endfor']); expect('endfor');
      return { t: 'fcfor', v, from, to, dir, step, body };
    }
    if (isKw('while') || isKw('foreach') || isKw('func') || isKw('function') || isKw('switch') || isKw('do') || isKw('try')) throw new Error(`${t[i].v} cannot be converted`);
    if (isKw('return')) throw new Error('return cannot be converted');
    if (is('{')) { i++; const b = stmts(['}']); expect('}'); return { t: 'seq', body: b }; }
    const e = expr();
    if (is(';')) i++;
    return { t: 'expr', e };
  }
  function stmts(end) {
    const out = [];
    for (;;) {
      while (is(';')) i++;
      if (!t[i] || end.some(v => is(v) || isKw(v))) return out;
      out.push(stmt());
    }
  }
  const prog = stmts([]);
  if (i < t.length) throw new Error(`unexpected '${t[i].v}'`);
  return prog;
}

// ------------------------------------------------------------------ symbolic execution
const PROPS = new Set(['rawValue', 'value', 'formattedValue', 'editValue', '$']);
const FC_FUNCS = { sum: 'Sum', avg: 'Avg', count: 'Count', max: 'Max', min: 'Min', round: 'Round', abs: 'Abs', floor: 'Floor', ceil: 'Ceil', mod: 'Mod',
  concat: 'Concat', upper: 'Upper', lower: 'Lower', len: 'Len', left: 'Left', right: 'Right', substr: 'Substr', replace: 'Replace', str: 'Str', ltrim: 'Trim', rtrim: 'Trim', hasvalue: 'HasValue', oneof: 'Oneof', within: 'Within', exists: 'Exists', wordnum: 'WordNum', choose: 'Choose', date: 'Date', time: 'Time' };
const STRING_FUNCS = new Set(['Concat', 'Upper', 'Lower', 'Trim', 'Left', 'Right', 'Substr', 'Replace', 'Str', 'WordNum', 'Format', 'AmountInWords']);

export function convertScript(src, { lang = 'js', self = '', ref = p => p } = {}) {
  const fc = /formcalc/i.test(lang);
  const prog = parse(String(src), fc);
  const env = new Map();
  const res = { effects: [], notes: [] };
  const selfNames = new Set(['this', '$', String(self)].filter(Boolean));
  let last = null;
  const T = { t: 'bool', v: true };
  const and = (a, b) => (!a ? b : !b ? a : { t: 'bin', op: 'and', l: a, r: b });
  const guard = (cond, v, prev) => (cond ? { t: 'cond', c: cond, a: v, b: prev ?? { t: 'null' } } : v);
  // a chain of members, indexes and calls -> { path, prop } of the object it names (or null)
  const pathOf = e => {
    const parts = [];
    let prop = null;
    const walk = n => {
      if (n.t === 'id') { parts.push(n.v); return true; }
      if (n.t === 'member') { if (!walk(n.o)) return false; parts.push(n.name); return true; }
      if (n.t === 'index') { if (!walk(n.o)) return false; if (n.i.t === 'star') parts[parts.length - 1] += '[*]'; else if (n.i.t === 'num') parts[parts.length - 1] += `[${n.i.v}]`; else if (n.i.t === 'loopvar') parts[parts.length - 1] += '[*]'; else return false; return true; }
      if (n.t === 'call' && n.f.t === 'member' && /^resolveNodes?$/.test(n.f.name) && n.args[0]?.t === 'str') { parts.push(...String(n.args[0].v).replace(/^\$\.|^\$form\.|^xfa\.form\./, '').replace(/\[\s*"\s*\+\s*\w+\s*\+\s*"\s*\]/g, '[*]').split('.')); return true; }
      if (n.t === 'call' && n.f.t === 'member' && n.f.name === 'item' && n.args.length === 1) { if (!walk(n.f.o)) return false; if (parts.at(-1) === 'all') parts.pop(); parts[parts.length - 1] += n.args[0].t === 'num' ? `[${n.args[0].v}]` : '[*]'; return true; }
      return false;
    };
    if (!walk(e)) return null;
    while (parts.length && /^(xfa|form|\$form|\$record|\$data|xfa\.form)$/.test(parts[0]) && parts.length > 1) parts.shift();
    if (PROPS.has(parts.at(-1))) { parts.pop(); prop = 'value'; }
    else if (['presence', 'access', 'fillColor', 'border', 'font', 'caption', 'mandatory'].includes(parts.at(-1))) prop = parts.pop();
    return { parts, prop };
  };
  const isSelf = parts => parts.length === 0 || (parts.length === 1 && selfNames.has(parts[0]));
  const dataRef = parts => (isSelf(parts) ? { t: 'ref', p: ref(String(self)) } : { t: 'ref', p: ref(parts.join('.')) });
  // an expression -> its symbolic value
  function ev(n) {
    switch (n.t) {
      case 'num': case 'str': case 'null': case 'bool': return n;
      case 'neg': return { t: 'neg', e: ev(n.e) };
      case 'not': return { t: 'not', e: ev(n.e) };
      case 'cond': return { t: 'cond', c: ev(n.c), a: ev(n.a), b: ev(n.b) };
      case 'if': {   // FormCalc if as an expression: the value of the last statement of the taken branch
        const vals = n.branches.map(([c, body]) => [ev(c), lastOf(body)]);
        return vals.reduceRight((acc, [c, v]) => ({ t: 'cond', c, a: v, b: acc }), lastOf(n.other));
      }
      case 'bin': {
        // x == null, x == '' -> not HasValue(x)
        if (['==', '===', '!=', '!==', '<>', 'eq', 'ne'].includes(n.op) && (n.r.t === 'null' || (n.r.t === 'str' && n.r.v === ''))) { const h = { t: 'fn', f: 'HasValue', args: [ev(n.l)] }; return /^(!|<>|ne)/.test(n.op) ? h : { t: 'not', e: h }; }
        return { t: 'bin', op: n.op, l: ev(n.l), r: ev(n.r) };
      }
      case 'assign': exec({ t: 'expr', e: n }, null); return { t: 'null' };
      case 'id':
        if (env.has(n.v)) return env.get(n.v);
        if (n.v === 'loopvar') return { t: 'num', v: 0 };
        break;
      case 'loopvar': throw new Error('the loop variable is used outside of a row reference');
      case 'post': throw new Error('++ / -- inside an expression cannot be converted');
    }
    // member chains and calls
    if (n.t === 'call') return call(n);
    if (n.t === 'member' && n.name === 'length') {
      const p = pathOf(n.o);
      if (p && (p.parts.at(-1) === 'all' || p.parts.at(-1) === 'nodes')) { p.parts.pop(); return { t: 'fn', f: 'Count', args: [{ t: 'ref', p: ref(`${p.parts.join('.')}[*]`) }] }; }
      return { t: 'fn', f: 'Len', args: [ev(n.o)] };
    }
    if (n.t === 'member' && n.name === 'count') {
      const p = pathOf(n.o);
      if (p) { if (p.parts.at(-1) === 'instanceManager') p.parts.pop(); const last = p.parts.pop() || ''; p.parts.push(last.replace(/^_/, '')); return { t: 'fn', f: 'Count', args: [{ t: 'ref', p: ref(`${p.parts.join('.')}[*]`) }] }; }
    }
    if (n.t === 'member' && n.o.t === 'id' && n.o.v === 'Math' && /^(PI|E)$/.test(n.name)) return { t: 'num', v: Math[n.name] };
    const p = pathOf(n);
    if (!p) throw new Error('an expression that cannot be converted');
    if (p.prop && p.prop !== 'value') throw new Error(`reading ${p.prop} cannot be converted`);
    if (p.parts.length === 1 && env.has(p.parts[0])) return env.get(p.parts[0]);
    return dataRef(p.parts);
  }
  const lastOf = body => { let v = { t: 'null' }; for (const s of body) { if (s.t === 'expr' && s.e.t !== 'assign') v = ev(s.e); else exec(s, null); } return v; };
  function call(n) {
    const args = () => n.args.map(ev);
    if (n.f.t === 'id') {
      const name = n.f.v, low = name.toLowerCase();
      if (/^(parseFloat|Number)$/.test(name)) return { t: 'fn', f: 'Num', args: args() };
      if (name === 'parseInt') return { t: 'fn', f: 'Floor', args: [{ t: 'fn', f: 'Num', args: [ev(n.args[0])] }] };
      if (name === 'String') return { t: 'fn', f: 'Concat', args: args() };
      if (name === 'isNaN') throw new Error('isNaN cannot be converted');
      if (fc && low === 'format') { const pic = n.args[0]?.t === 'str' ? n.args[0].v : ''; return { t: 'fn', f: 'Format', args: [ev(n.args[1]), { t: 'str', v: /date/i.test(pic) ? 'date' : /time/i.test(pic) ? 'time' : 'amount' }] }; }
      if (fc && low === 'num2date') return { t: 'fn', f: 'Concat', args: [ev(n.args[0])] };
      if (FC_FUNCS[low]) return { t: 'fn', f: FC_FUNCS[low], args: args() };
      throw new Error(`function ${name}() cannot be converted`);
    }
    if (n.f.t === 'member') {
      const o = n.f.o, m = n.f.name;
      if (o.t === 'id' && o.v === 'Math') {
        const MAP = { round: 'Round', abs: 'Abs', floor: 'Floor', ceil: 'Ceil', min: 'Min', max: 'Max', pow: 'Pow' };
        if (!MAP[m]) throw new Error(`Math.${m} cannot be converted`);
        return { t: 'fn', f: MAP[m], args: m === 'round' ? [ev(n.args[0]), { t: 'num', v: 0 }] : args() };
      }
      if (o.t === 'member' && o.o.t === 'id' && o.o.v === 'xfa' && o.name === 'host') { res.notes.push(`xfa.host.${m}() left out (it runs in Adobe Reader only)`); return { t: 'null' }; }
      if (o.t === 'id' && o.v === 'app') { res.notes.push(`app.${m}() left out (it runs in Adobe Reader only)`); return { t: 'null' }; }
      if (o.t === 'id' && o.v === 'util' && m === 'printd') return { t: 'fn', f: 'Format', args: [ev(n.args[1]), { t: 'str', v: 'date' }] };
      if (/^resolveNodes?$/.test(m) || m === 'item') { const p = pathOf(n); if (p) return dataRef(p.parts); }
      const x = ev(o);
      if (m === 'toFixed') return { t: 'fn', f: 'Round', args: [x, n.args[0] ? ev(n.args[0]) : { t: 'num', v: 0 }] };
      if (m === 'toUpperCase') return { t: 'fn', f: 'Upper', args: [x] };
      if (m === 'toLowerCase') return { t: 'fn', f: 'Lower', args: [x] };
      if (m === 'trim') return { t: 'fn', f: 'Trim', args: [x] };
      if (m === 'toString') return { t: 'fn', f: 'Concat', args: [x] };
      if (m === 'concat') return { t: 'fn', f: 'Concat', args: [x, ...args()] };
      if (m === 'substr') return { t: 'fn', f: 'Substr', args: [x, { t: 'bin', op: '+', l: ev(n.args[0]), r: { t: 'num', v: 1 } }, ...(n.args[1] ? [ev(n.args[1])] : [])] };
      if (m === 'substring') return { t: 'fn', f: 'Substr', args: [x, { t: 'bin', op: '+', l: ev(n.args[0]), r: { t: 'num', v: 1 } }, ...(n.args[1] ? [{ t: 'bin', op: '-', l: ev(n.args[1]), r: ev(n.args[0]) }] : [])] };
      if (m === 'charAt') return { t: 'fn', f: 'Substr', args: [x, { t: 'bin', op: '+', l: ev(n.args[0]), r: { t: 'num', v: 1 } }, { t: 'num', v: 1 }] };
      if (m === 'replace' && n.args[0]?.t === 'str') return { t: 'fn', f: 'Replace', args: [x, ...args()] };
      if (m === 'isNull') return { t: 'not', e: { t: 'fn', f: 'HasValue', args: [x] } };
      throw new Error(`.${m}() cannot be converted`);
    }
    throw new Error('a call that cannot be converted');
  }
  // assignments: local variables, the object's value and presence, other objects' value and presence
  function assignTo(l, v, cond, op, decl) {
    if (decl) { env.set(l.v, v); return; }
    if (op !== '=') { const cur = l.t === 'id' && env.has(l.v) ? env.get(l.v) : ev(l); v = { t: 'bin', op: op[0], l: cur, r: v }; }
    // a local variable (JavaScript: any plain name; FormCalc: declared with var); FormCalc: Name = … sets an object
    if (l.t === 'id' && (env.has(l.v) || (!fc && !selfNames.has(l.v)))) { env.set(l.v, guard(cond, v, env.get(l.v))); return; }
    const p = pathOf(l);
    if (!p) throw new Error('an assignment that cannot be converted');
    if (p.prop === 'presence') {
      const visOf = x => (x.t === 'str' ? { t: 'bool', v: x.v === 'visible' } : x.t === 'cond' ? { t: 'cond', c: x.c, a: visOf(x.a), b: visOf(x.b) } : { t: 'bin', op: '=', l: x, r: { t: 'str', v: 'visible' } });
      const vis = visOf(v);
      if (isSelf(p.parts)) res.visible = guard(cond, vis, res.visible ?? T);
      else { const target = p.parts.at(-1).replace(/\[.*\]$/, ''); const e = res.effects.find(x => x.target === target) || (res.effects.push({ target }), res.effects.at(-1)); e.visibleAst = guard(cond, vis, e.visibleAst ?? T); }
      return;
    }
    if (p.prop && p.prop !== 'value') { res.notes.push(`setting ${p.prop} left out (appearance)`); return; }
    if (isSelf(p.parts)) { res.valueAst = guard(cond, v, res.valueAst); return; }
    const target = p.parts.at(-1).replace(/\[.*\]$/, '');
    const e = res.effects.find(x => x.target === target) || (res.effects.push({ target }), res.effects.at(-1));
    e.valueAst = guard(cond, v, e.valueAst);
  }
  function exec(s, cond) {
    switch (s.t) {
      case 'empty': return;
      case 'seq': for (const x of s.body) exec(x, cond); return;
      case 'expr':
        if (s.e.t === 'assign') return assignTo(s.e.l, ev(s.e.r), cond, s.e.op, s.e.decl);
        if (s.e.t === 'post') { const n = s.e.e; if (n.t === 'id') return assignTo(n, { t: 'num', v: 1 }, cond, s.e.op === '++' ? '+=' : '-='); throw new Error('++ / -- cannot be converted'); }
        last = guard(cond, ev(s.e), last);
        return;
      case 'if': {
        let rest = cond;
        for (const [c, body] of s.branches) { const cc = ev(c); for (const x of body) exec(x, and(rest, cc)); rest = and(rest, { t: 'not', e: cc }); }
        for (const x of s.other) exec(x, rest);
        return;
      }
      case 'for': case 'fcfor': return loop(s, cond);
    }
    throw new Error(`a ${s.t} statement cannot be converted`);
  }
  // a loop over the rows of a table that adds up: acc += <row expression> -> acc + Sum(<column expression>)
  function loop(s, cond) {
    const v = s.t === 'fcfor' ? s.v : s.init?.body?.[0]?.e?.l?.v || s.init?.e?.l?.v;
    if (!v) throw new Error('the loop cannot be converted');
    const sub = n => {   // the loop variable as a row index: [*]
      if (!n || typeof n !== 'object') return n;
      if (n.t === 'id' && n.v === v) return { t: 'loopvar' };
      // resolveNode("Row[" + i + "].amount") -> "Row[*].amount"
      if (n.t === 'bin' && n.op === '+' && n.l.t === 'bin' && n.l.op === '+' && n.l.l.t === 'str' && n.l.r.t === 'id' && n.l.r.v === v && n.r.t === 'str') return { t: 'str', v: `${n.l.l.v.replace(/\[$/, '')}[*]${n.r.v.replace(/^\]/, '')}` };
      const out = Array.isArray(n) ? [] : {};
      for (const [k, x] of Object.entries(n)) out[k] = Array.isArray(x) ? x.map(sub) : x && typeof x === 'object' ? sub(x) : x;
      return out;
    };
    const body = sub(s.body);
    for (const st of body) {
      const inner = st.t === 'if' && st.branches.length === 1 && !st.other.length ? st.branches[0][1] : [st];
      const rowCond = st.t === 'if' ? ev(st.branches[0][0]) : null;
      for (const x of inner) {
        if (x.t !== 'expr' || x.e.t !== 'assign' || !['+=', '='].includes(x.e.op) || x.e.l.t !== 'id' || !env.has(x.e.l.v)) throw new Error('only loops that add up rows (total += row value) can be converted');
        let term = x.e.op === '+=' ? x.e.r : (x.e.r.t === 'bin' && x.e.r.op === '+' && x.e.r.l.t === 'id' && x.e.r.l.v === x.e.l.v ? x.e.r.r : null);
        if (!term) throw new Error('only loops that add up rows (total += row value) can be converted');
        let tv = ev(term);
        if (rowCond) tv = { t: 'fn', f: 'If', args: [rowCond, tv, { t: 'num', v: 0 }] };
        env.set(x.e.l.v, guard(cond, { t: 'bin', op: '+', l: env.get(x.e.l.v), r: { t: 'fn', f: 'Sum', args: [tv] } }, env.get(x.e.l.v)));
      }
    }
  }
  for (const s of prog) exec(s, null);
  // a calculate script's value: the assignment to the object, else the last expression
  const value = res.valueAst ?? last;
  const out = { effects: res.effects.map(e => ({ target: e.target, ...(e.valueAst ? { value: emit(simplify(e.valueAst)) } : {}), ...(e.visibleAst ? { visible: emit(simplify(e.visibleAst)) } : {}) })), notes: res.notes };
  if (value && value.t !== 'null') out.value = emit(simplify(value));
  if (res.visible) out.visible = emit(simplify(res.visible));
  return out;
}

// smaller expressions: if c then true else x -> c or x, x or x -> x, not not x -> x, true and x -> x,
// if not c then a else (if c then b else …) -> if c then b else a
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const negates = (a, b) => (a.t === 'not' && same(a.e, b)) || (b.t === 'not' && same(b.e, a));
function simplify(n) {
  if (!n || typeof n !== 'object') return n;
  for (const k of ['l', 'r', 'e', 'c', 'a', 'b']) if (n[k]) n[k] = simplify(n[k]);
  if (n.args) n.args = n.args.map(simplify);
  if (n.t === 'not' && n.e.t === 'not') return n.e.e;
  if (n.t === 'not' && n.e.t === 'bool') return { t: 'bool', v: !n.e.v };
  if (n.t === 'cond') {
    if (n.c.t === 'bool') return n.c.v ? n.a : n.b;
    if (same(n.a, n.b)) return n.a;
    if (n.b.t === 'cond' && negates(n.c, n.b.c)) return simplify({ t: 'cond', c: n.b.c, a: n.b.a, b: n.a });
    if (n.a.t === 'bool' && n.b.t === 'bool') return n.a.v ? n.c : simplify({ t: 'not', e: n.c });
    if (n.a.t === 'bool') return simplify(n.a.v ? { t: 'bin', op: 'or', l: n.c, r: n.b } : { t: 'bin', op: 'and', l: { t: 'not', e: n.c }, r: n.b });
  }
  if (n.t === 'bin' && n.op === '+' && n.l.t === 'num' && n.l.v === 0) return n.r;
  if (n.t === 'bin' && (n.op === 'and' || n.op === 'or' || n.op === '&&' || n.op === '||')) {
    const isAnd = n.op === 'and' || n.op === '&&';
    if (same(n.l, n.r)) return n.l;
    if (n.l.t === 'bool') return n.l.v === isAnd ? n.r : n.l;
    if (n.r.t === 'bool') return n.r.v === isAnd ? n.l : n.r;
    if (!isAnd && negates(n.l, n.r)) return { t: 'bool', v: true };
  }
  return n;
}

// symbolic value -> the expression language of the layouts
const isText = n => n.t === 'str' || (n.t === 'fn' && STRING_FUNCS.has(n.f)) || (n.t === 'bin' && n.op === '&');
function emit(n) {
  const q = s => `'${String(s).replace(/'/g, "''")}'`;
  const wrap = x => (['bin', 'cond'].includes(x.t) ? `(${emit(x)})` : emit(x));
  switch (n.t) {
    case 'num': return String(n.v);
    case 'str': return q(n.v);
    case 'bool': return n.v ? 'true' : 'false';
    case 'null': return "''";
    case 'ref': return n.p;
    case 'neg': return `-${wrap(n.e)}`;
    case 'not': return `not ${wrap(n.e)}`;
    case 'fn': return `${n.f}(${n.args.map(emit).join(', ')})`;
    case 'cond': return `if ${emit(n.c)} then ${emit(n.a)} else ${emit(n.b)} endif`;
    case 'bin': {
      // x == null / x == '' -> not HasValue(x)
      if (['==', '===', '!=', '!==', '<>', 'eq', 'ne'].includes(n.op) && (n.r.t === 'null' || (n.r.t === 'str' && n.r.v === ''))) return `${/^(!|<>|ne)/.test(n.op) ? '' : 'not '}HasValue(${emit(n.l)})`;
      const op = { '==': '=', '===': '=', '!=': '<>', '!==': '<>', eq: '=', ne: '<>', lt: '<', gt: '>', le: '<=', ge: '>=', '&&': 'and', '||': 'or', '&': 'and', '|': 'or', '%': 'mod' }[n.op] || n.op;
      const o = op === '+' && (isText(n.l) || isText(n.r)) ? '&' : op;
      return `${wrap(n.l)} ${o} ${wrap(n.r)}`;
    }
  }
  throw new Error(`cannot express ${n.t}`);
}
