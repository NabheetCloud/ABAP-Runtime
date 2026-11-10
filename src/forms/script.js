// Form calculations, the counterpart of FormCalc in Adobe forms: expressions over the form's data, used in
// placeholders {= net * 1.19 }, form variables ("variables": { "net": "Sum(_item.amount)" }), calculated table
// columns ("calc": "quantity * price") and conditions ("if": "status = 'O' and net > 1000").
//
//   values      1.5  'text'  "text"  field  struct.field  {struct-field}  _item.amount (a column of a table)
//               _item[0].amount  null  true  false
//   operators   + - * /  mod  & (concatenation)  = == <> != < > <= >=  eq ne lt gt le ge  and or not  && || !
//               if c then a [elseif c then b] else d endif     ( )
//   functions   (case-insensitive) Sum Count Avg Min Max  Round(n, dec) Abs Floor Ceil Mod(a, b) Pow(a, b)
//               Concat(…) Upper Lower Len Left(s, n) Right(s, n) Substr(s, start, n) (1-based) Replace(s, a, b)
//               Trim Str(n, dec) Num(s)  If(c, a, b) Choose(n, a, b, …) Oneof(v, a, b, …) Within(v, lo, hi)
//               HasValue(v) Exists(v)  Date() (today, YYYYMMDD) Time() AddDays(date, n) DaysBetween(d1, d2)
//               Format(v, 'date' | 'amount' | 'currency', arg)  WordNum(n) (1,250 -> "One Thousand Two Hundred
//               Fifty") AmountInWords(n, 'EUR')
// Data paths go through tables: _item.amount is the list of the amounts of all items (for Sum, Count, …); operators
// and the functions of single values work row by row on such lists: Sum(_item.quantity * _item.price),
// Sum(If(_item.status = 'X', _item.amount, 0)).

const KW = new Set(['and', 'or', 'not', 'if', 'then', 'elseif', 'else', 'endif', 'mod', 'eq', 'ne', 'lt', 'gt', 'le', 'ge', 'null', 'true', 'false']);

function tokenize(src) {
  const out = [];
  const re = /\s*(?:(\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|\.\d+)|('(?:[^']|'')*'|"(?:[^"\\]|\\.|"")*")|(\{[\w./-]+\})|([A-Za-z_$][\w$]*(?:\[\d+\]|\[\*\])?(?:\.[A-Za-z_$][\w$]*(?:\[\d+\]|\[\*\])?)*)|(==|<>|!=|<=|>=|&&|\|\||[-+*/&=<>(),!]))/y;
  let m;
  while (re.lastIndex < src.length) {
    const at = re.lastIndex;
    if (/^\s*$/.test(src.slice(at))) break;
    if (!(m = re.exec(src))) throw new Error(`Cannot read the expression at '${src.slice(at).trim().slice(0, 20)}' in: ${src}`);
    if (m[1] !== undefined) out.push({ k: 'num', v: Number(m[1]) });
    else if (m[2] !== undefined) { const q = m[2][0]; out.push({ k: 'str', v: m[2].slice(1, -1).replaceAll(q + q, q).replace(/\\(.)/g, '$1') }); }
    else if (m[3] !== undefined) out.push({ k: 'id', v: m[3].slice(1, -1) });
    else if (m[4] !== undefined) {
      const w = m[4].toLowerCase();
      if (KW.has(w)) out.push({ k: 'kw', v: w });
      else out.push({ k: 'id', v: m[4] });
    } else out.push({ k: 'op', v: m[5] });
  }
  return out;
}

const cache = new Map();
export function compile(src) {
  const key = String(src);
  if (cache.has(key)) return cache.get(key);
  const t = tokenize(key);
  let i = 0;
  const peek = () => t[i], next = () => t[i++];
  const isOp = (...v) => t[i] && (t[i].k === 'op' || t[i].k === 'kw') && v.includes(t[i].v);
  const expect = v => { if (!isOp(v)) throw new Error(`Expected '${v}' in: ${key}`); i++; };
  const bin = (sub, ops, map = {}) => () => { let l = sub(); while (isOp(...ops)) { const op = next().v; l = { k: 'bin', op: map[op] || op, l, r: sub() }; } return l; };
  const unary = () => {
    if (isOp('-')) { i++; return { k: 'neg', e: unary() }; }
    if (isOp('+')) { i++; return unary(); }
    if (isOp('not', '!')) { i++; return { k: 'not', e: unary() }; }
    return primary();
  };
  const mul = bin(unary, ['*', '/', 'mod']);
  const add = bin(mul, ['+', '-', '&']);
  const rel = bin(add, ['<', '>', '<=', '>=', 'lt', 'gt', 'le', 'ge'], { lt: '<', gt: '>', le: '<=', ge: '>=' });
  const eq = bin(rel, ['=', '==', '<>', '!=', 'eq', 'ne'], { '==': '=', '!=': '<>', eq: '=', ne: '<>' });
  const and = bin(eq, ['and', '&&'], { '&&': 'and' });
  const or = bin(and, ['or', '||'], { '||': 'or' });
  function primary() {
    const tok = next();
    if (!tok) throw new Error(`Incomplete expression: ${key}`);
    if (tok.k === 'num' || tok.k === 'str') return { k: 'lit', v: tok.v };
    if (tok.k === 'kw' && tok.v === 'null') return { k: 'lit', v: '' };
    if (tok.k === 'kw' && (tok.v === 'true' || tok.v === 'false')) return { k: 'lit', v: tok.v === 'true' };
    if (tok.k === 'kw' && tok.v === 'if' && isOp('(')) {
      // If(c, a, b) (a function) or if (c) then … endif
      const at = i; i++;
      const args = [or()]; while (isOp(',')) { i++; args.push(or()); }
      expect(')');
      if (args.length > 1 || !isOp('then')) return { k: 'call', fn: FUNCTIONS.if, name: 'If', args };
      i = at;
    }
    if (tok.k === 'kw' && tok.v === 'if') {
      const branches = [];
      let cond = or(); expect('then'); branches.push([cond, or()]);
      let other = { k: 'lit', v: '' };
      for (;;) {
        if (isOp('elseif')) { i++; cond = or(); expect('then'); branches.push([cond, or()]); continue; }
        if (isOp('else')) { i++; other = or(); }
        expect('endif'); break;
      }
      return { k: 'if', branches, other };
    }
    if (tok.k === 'op' && tok.v === '(') { const e = or(); expect(')'); return e; }
    if (tok.k === 'id') {
      if (isOp('(')) {
        i++;
        const args = [];
        if (!isOp(')')) { args.push(or()); while (isOp(',')) { i++; args.push(or()); } }
        expect(')');
        const fn = FUNCTIONS[tok.v.toLowerCase()];
        if (!fn) throw new Error(`Unknown function ${tok.v}() in: ${key}`);
        return { k: 'call', fn, name: tok.v, args };
      }
      return { k: 'ref', path: tok.v };
    }
    throw new Error(`Unexpected '${tok.v}' in: ${key}`);
  }
  const ast = or();
  if (i < t.length) throw new Error(`Unexpected '${t[i].v}' in: ${key}`);
  cache.set(key, ast);
  return ast;
}

// a data path; through tables it gives the list of values (_item.amount); [n] picks a line (0-based)
export function resolve(data, name) {
  let cur = [data], many = false;
  const parts = String(name).split(/[-.]/);
  parts.forEach((raw, k) => {
    const m = /^([^[]+)(?:\[(\d+|\*)\])?$/.exec(raw);
    const part = (m ? m[1] : raw).toLowerCase();
    const next = [];
    for (const c of cur) {
      if (c == null || typeof c !== 'object') continue;
      let v = c[part] ?? c[part.toUpperCase()] ?? c[m ? m[1] : raw];
      if (m?.[2] !== undefined && Array.isArray(v)) { if (m[2] === '*') { next.push(...v); many = true; continue; } v = v[Number(m[2])]; }
      // a table in the middle of a path: its lines
      if (Array.isArray(v) && k < parts.length - 1) { next.push(...v); many = true; } else next.push(v);
    }
    cur = next;
  });
  if (many) return cur.map(v => v ?? '');
  return cur[0] ?? '';
}

export const num = v => { if (typeof v === 'number') return v; if (typeof v === 'boolean') return v ? 1 : 0; const n = Number(String(v ?? '').trim().replace(/^(-?)\s+/, '$1')); return Number.isFinite(n) ? n : 0; };
export const truthy = v => !(v === '' || v === 0 || v === '0' || v === null || v === undefined || v === false || (Array.isArray(v) && !v.length) || /^\s*-?0+(\.0+)?\s*$/.test(String(v)) || String(v).trim() === '');
const isNumeric = v => typeof v === 'number' || (String(v ?? '').trim() !== '' && Number.isFinite(Number(v)));
const flat = args => args.flatMap(a => (Array.isArray(a) ? a : [a]));
const cmp = (a, op, b) => {
  const numeric = isNumeric(a) && isNumeric(b);
  const x = numeric ? Number(a) : String(a ?? '').trim(), y = numeric ? Number(b) : String(b ?? '').trim();
  return { '=': x === y, '<>': x !== y, '<': x < y, '>': x > y, '<=': x <= y, '>=': x >= y }[op];
};
const round = (n, d = 0) => { const f = 10 ** d; return Math.round((num(n) + Number.EPSILON * Math.sign(num(n))) * f) / f; };
const ymd = d => `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
const toDate = s => { const v = String(s); return /^\d{8}$/.test(v) ? new Date(Date.UTC(+v.slice(0, 4), +v.slice(4, 6) - 1, +v.slice(6, 8))) : null; };

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
export function wordNum(n) {
  n = Math.floor(Math.abs(num(n)));
  if (n === 0) return 'Zero';
  const under1000 = k => [k >= 100 ? `${ONES[Math.floor(k / 100)]} Hundred` : '', k % 100 < 20 ? ONES[k % 100] : `${TENS[Math.floor(k % 100 / 10)]}${k % 10 ? ` ${ONES[k % 10]}` : ''}`].filter(Boolean).join(' ');
  const parts = [];
  for (const [unit, name] of [[1e12, 'Trillion'], [1e9, 'Billion'], [1e6, 'Million'], [1e3, 'Thousand'], [1, '']]) {
    const k = Math.floor(n / unit) % 1000;
    if (k) parts.push(`${under1000(k)}${name ? ` ${name}` : ''}`);
  }
  return parts.join(' ');
}

const FUNCTIONS = {
  sum: (...a) => flat(a).reduce((s, v) => s + num(v), 0),
  count: (...a) => flat(a).filter(v => String(v ?? '') !== '').length,
  avg: (...a) => { const v = flat(a).filter(x => String(x ?? '') !== ''); return v.length ? v.reduce((s, x) => s + num(x), 0) / v.length : 0; },
  min: (...a) => { const v = flat(a).filter(x => String(x ?? '') !== '').map(num); return v.length ? Math.min(...v) : 0; },
  max: (...a) => { const v = flat(a).filter(x => String(x ?? '') !== '').map(num); return v.length ? Math.max(...v) : 0; },
  round: (n, d) => round(n, num(d)),
  abs: n => Math.abs(num(n)), floor: n => Math.floor(num(n)), ceil: n => Math.ceil(num(n)),
  mod: (a, b) => num(a) % num(b), pow: (a, b) => num(a) ** num(b),
  concat: (...a) => flat(a).map(v => String(v ?? '')).join(''),
  upper: s => String(s ?? '').toUpperCase(), lower: s => String(s ?? '').toLowerCase(), trim: s => String(s ?? '').trim(),
  len: s => String(s ?? '').length,
  left: (s, n) => String(s ?? '').slice(0, num(n)), right: (s, n) => { const v = String(s ?? ''); return num(n) ? v.slice(-num(n)) : ''; },
  substr: (s, start, n) => String(s ?? '').substr(Math.max(0, num(start) - 1), n === undefined ? undefined : num(n)),
  replace: (s, a, b = '') => String(s ?? '').split(String(a)).join(String(b)),
  str: (n, d) => (d === undefined ? String(num(n)) : num(n).toFixed(num(d))),
  num: s => num(s),
  if: (c, a, b = '') => (truthy(c) ? a : b),
  choose: (n, ...a) => a[num(n) - 1] ?? '',
  oneof: (v, ...a) => flat(a).some(x => cmp(v, '=', x)),
  within: (v, lo, hi) => cmp(v, '>=', lo) && cmp(v, '<=', hi),
  hasvalue: v => truthy(Array.isArray(v) ? v.length : String(v ?? '').trim()),
  exists: v => (Array.isArray(v) ? v.length > 0 : v !== undefined && v !== null && v !== ''),
  date: () => ymd(new Date()),
  time: () => new Date().toISOString().slice(11, 19).replace(/:/g, ''),
  adddays: (d, n) => { const x = toDate(d); if (!x) return ''; x.setUTCDate(x.getUTCDate() + num(n)); return ymd(x); },
  daysbetween: (a, b) => { const x = toDate(a), y = toDate(b); return x && y ? Math.round((y - x) / 86400000) : 0; },
  wordnum: n => wordNum(n),
  amountinwords: (n, cur = '') => { const v = Math.abs(num(n)); const cents = Math.round((v - Math.floor(v)) * 100); return `${wordNum(v)}${cur ? ` ${String(cur).toUpperCase()}` : ''}${cents ? ` and ${String(cents).padStart(2, '0')}/100` : ''}`; },
  format: null,   // set by the engine (needs the locale)
};

// functions of single values: applied row by row to lists
const ROWWISE = new Set(['round', 'abs', 'floor', 'ceil', 'mod', 'pow', 'upper', 'lower', 'trim', 'len', 'left', 'right', 'substr', 'replace', 'str', 'num', 'if', 'within', 'adddays', 'daysbetween', 'wordnum', 'format']);
const rowwise = (args, fn) => {
  const n = Math.max(...args.map(a => (Array.isArray(a) ? a.length : 0)));
  return Array.from({ length: n }, (_, k) => fn(...args.map(a => (Array.isArray(a) ? a[k] ?? '' : a))));
};

export function evaluate(src, data, { format } = {}) {
  const ast = typeof src === 'string' ? compile(src) : src;
  const ev = n => {
    switch (n.k) {
      case 'lit': return n.v;
      case 'ref': return resolve(data, n.path);
      case 'neg': { const v = ev(n.e); return Array.isArray(v) ? v.map(x => -num(x)) : -num(v); }
      case 'not': { const v = ev(n.e); return Array.isArray(v) ? v.map(x => !truthy(x)) : !truthy(v); }
      case 'if': {
        const conds = n.branches.map(([c]) => ev(c));
        if (conds.some(Array.isArray)) {   // row by row
          const vals = n.branches.map(([, v]) => ev(v)), other = ev(n.other);
          return rowwise([...conds, ...vals, other], (...xs) => { const k = conds.length; for (let j = 0; j < k; j++) if (truthy(xs[j])) return xs[k + j]; return xs[2 * k]; });
        }
        for (let j = 0; j < conds.length; j++) if (truthy(conds[j])) return ev(n.branches[j][1]);
        return ev(n.other);
      }
      case 'call': {
        const low = n.name.toLowerCase();
        if (low === 'if') { const c = ev(n.args[0]); if (!Array.isArray(c)) return truthy(c) ? ev(n.args[1]) : n.args[2] ? ev(n.args[2]) : ''; }
        const args = n.args.map(ev);
        const fn = low === 'format' ? (v, k, x) => (format ? format(v, String(k ?? ''), x) : String(v ?? '')) : low === 'if' ? (c, a, b = '') => (truthy(c) ? a : b) : n.fn;
        if (ROWWISE.has(low) && args.some(Array.isArray)) return rowwise(args, fn);
        return fn(...args);
      }
      case 'bin': {
        if (n.op === 'and' || n.op === 'or') {
          const a = ev(n.l);
          if (!Array.isArray(a) && (n.op === 'and' ? !truthy(a) : truthy(a))) return n.op === 'or';
          const b = ev(n.r);
          if (Array.isArray(a) || Array.isArray(b)) return rowwise([a, b], (x, y) => (n.op === 'and' ? truthy(x) && truthy(y) : truthy(x) || truthy(y)));
          return truthy(b);
        }
        const a = ev(n.l), b = ev(n.r);
        if (Array.isArray(a) || Array.isArray(b)) return rowwise([a, b], (x, y) => binop(n.op, x, y));
        return binop(n.op, a, b);
      }
    }
    throw new Error(`Cannot evaluate ${n.k}`);
  };
  const binop = (op, a, b) => {
        switch (op) {
          case '+': return num(a) + num(b);
          case '-': return num(a) - num(b);
          case '*': return num(a) * num(b);
          case '/': { const d = num(b); if (d === 0) throw new Error('Division by zero'); return num(a) / d; }
          case 'mod': return num(a) % num(b);
          case '&': return `${a ?? ''}${b ?? ''}`;
          default: return cmp(a, op, b);
        }
  };
  const v = ev(ast);
  // binary floating point: 0.1 + 0.2 is 0.3 on a form
  return typeof v === 'number' && !Number.isInteger(v) ? Number(v.toPrecision(15)) : v;
}

// an expression as Acrobat JavaScript, for the calculation of a fillable field (recalculated in Acrobat / Reader
// while the user fills the form): names of fillable fields are read from the form, everything else is the data the
// form was rendered with (a constant). Throws for what has no JavaScript counterpart.
const JS_HELPERS = 'var d=event.target.doc;function V(n){var f=d.getField(n);return f?f.value:"";}function N(v){var x=Number(String(v).replace(",","."));return isNaN(x)?0:x;}function T(v){return !(v===""||v===0||v==="0"||v===false||v===null);}function C(a,o,b){var p=String(a).replace(/^\\s+|\\s+$/g,""),q=String(b).replace(/^\\s+|\\s+$/g,"");if(p!==""&&q!==""&&!isNaN(Number(p))&&!isNaN(Number(q))){p=Number(p);q=Number(q);}switch(o){case"=":return p===q;case"<>":return p!==q;case"<":return p<q;case">":return p>q;case"<=":return p<=q;default:return p>=q;}}function R(n,k){var f=Math.pow(10,k||0);return Math.round(n*f)/f;}';
export function toAcrobatJs(src, { fields = new Set(), data = {} } = {}) {
  const ast = compile(String(src));
  const usesField = n => n && typeof n === 'object' && ((n.k === 'ref' && fields.has(n.path)) || Object.values(n).some(v => (Array.isArray(v) ? v.some(x => (Array.isArray(x) ? x.some(usesField) : usesField(x))) : usesField(v))));
  const js = n => {
    if (!usesField(n)) { const v = evaluate(n, data); return JSON.stringify(Array.isArray(v) ? v : v ?? ''); }
    switch (n.k) {
      case 'ref': return `V(${JSON.stringify(n.path)})`;
      case 'neg': return `(-N(${js(n.e)}))`;
      case 'not': return `(!T(${js(n.e)}))`;
      case 'if': return `${n.branches.map(([c, v]) => `(T(${js(c)})?${js(v)}:`).join('')}${js(n.other)}${')'.repeat(n.branches.length)}`;
      case 'bin': {
        const a = js(n.l), b = js(n.r);
        if (['+', '-', '*', '/'].includes(n.op)) return `(N(${a})${n.op}N(${b}))`;
        if (n.op === 'mod') return `(N(${a})%N(${b}))`;
        if (n.op === '&') return `(String(${a})+String(${b}))`;
        if (n.op === 'and' || n.op === 'or') return `(T(${a})${n.op === 'and' ? '&&' : '||'}T(${b}))`;
        return `C(${a},${JSON.stringify(n.op)},${b})`;
      }
      case 'call': {
        const f = n.name.toLowerCase(), a = n.args.map(js);
        const nums = () => a.map(x => `N(${x})`);
        switch (f) {
          case 'round': return `R(N(${a[0]}),${a[1] ? `N(${a[1]})` : 0})`;
          case 'abs': case 'floor': case 'ceil': return `Math.${f}(N(${a[0]}))`;
          case 'min': case 'max': return `Math.${f}(${nums().join(',')})`;
          case 'sum': return `(${nums().join('+')})`;
          case 'concat': return `(${a.map(x => `String(${x})`).join('+')})`;
          case 'upper': return `String(${a[0]}).toUpperCase()`;
          case 'lower': return `String(${a[0]}).toLowerCase()`;
          case 'len': return `String(${a[0]}).length`;
          case 'hasvalue': return `(String(${a[0]}).replace(/\\s/g,"")!=="")`;
          case 'num': return `N(${a[0]})`;
          case 'if': return `(T(${a[0]})?${a[1]}:${a[2] ?? '""'})`;
        }
        throw new Error(`${n.name}() of fillable fields is not recalculated in the PDF`);
      }
    }
    throw new Error(`cannot express ${n.k} in JavaScript`);
  };
  return `${JS_HELPERS}event.value=${js(ast)};`;
}
