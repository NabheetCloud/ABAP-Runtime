// FormCalc, the script language of Adobe XFA forms: an interpreter (lexer, parser, evaluator) with its function
// library. The form's objects come from the script runtime (script.js) as accessors: env.som(path, node) resolves
// SOM references (Field, Table.Row[*].Amount, $, $record.X, !…), env.get / env.set read and write a property.
// FormCalc: numbers and strings convert into each other as needed; null is empty; the value of the last
// expression is the script's value (the field's value for a calculate script).

import { formatPicture } from './picture.js';

const KEYWORDS = new Set(['if', 'then', 'elseif', 'else', 'endif', 'while', 'do', 'endwhile', 'for', 'upto', 'downto', 'step', 'endfor', 'foreach', 'in', 'var', 'func', 'endfunc', 'return', 'break', 'continue', 'null', 'and', 'or', 'not', 'eq', 'ne', 'lt', 'gt', 'le', 'ge']);

function lex(src) {
  const toks = [];
  let i = 0;
  const s = String(src);
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === '/' && s[i + 1] === '/' || c === ';') { while (i < s.length && s[i] !== '\n') i++; continue; }   // comments: // and ;
    if (c === '"') {
      let v = ''; i++;
      while (i < s.length) { if (s[i] === '"' && s[i + 1] === '"') { v += '"'; i += 2; continue; } if (s[i] === '"') break; if (s[i] === '\\' && s[i + 1] === 'u') { v += String.fromCharCode(parseInt(s.slice(i + 2, i + 6), 16)); i += 6; continue; } v += s[i++]; }
      i++; toks.push({ t: 'str', v }); continue;
    }
    let m = /^(\d+\.?\d*(?:[eE][-+]?\d+)?|\.\d+(?:[eE][-+]?\d+)?)/.exec(s.slice(i));
    if (m) { toks.push({ t: 'num', v: Number(m[1]) }); i += m[1].length; continue; }
    m = /^(==|<>|<=|>=|\*\*)/.exec(s.slice(i));
    if (m) { toks.push({ t: 'op', v: m[1] }); i += m[1].length; continue; }
    // identifiers and SOM paths: $, $record, !x, a.b[*].c, #subform[0], a..b (descendants)
    m = /^([$!#A-Za-z_][\w$#]*(?:\[(?:\*|[-+]?\d+)\])?(?:\.{1,2}#?[\w$]+(?:\[(?:\*|[-+]?\d+)\])?)*)/.exec(s.slice(i));
    if (m) {
      const word = m[1];
      if (KEYWORDS.has(word.toLowerCase())) toks.push({ t: 'kw', v: word.toLowerCase() });
      else toks.push({ t: 'id', v: word });
      i += word.length; continue;
    }
    if ('+-*/()=<>,&|.'.includes(c)) { toks.push({ t: 'op', v: c }); i++; continue; }
    if (c === '[' || c === ']') { toks.push({ t: 'op', v: c }); i++; continue; }
    throw new Error(`FormCalc: unexpected "${c}"`);
  }
  return toks;
}

function parse(src) {
  const toks = lex(src);
  let p = 0;
  const peek = (k = 0) => toks[p + k];
  const is = (t, v) => peek() && peek().t === t && (v === undefined || peek().v === v);
  const kw = v => is('kw', v);
  const op = v => is('op', v);
  const eat = (t, v) => { if (!is(t, v)) throw new Error(`FormCalc: expected ${v || t} near ${JSON.stringify(peek()?.v)}`); return toks[p++]; };
  const block = (...ends) => { const out = []; while (peek() && !ends.some(e => kw(e))) out.push(statement()); return out; };
  function statement() {
    if (kw('var')) { p++; const name = eat('id').v; let init = null; if (op('=')) { p++; init = expr(); } return { k: 'var', name, init }; }
    if (kw('if')) {
      p++; eat('op', '('); const cond = expr(); eat('op', ')'); eat('kw', 'then');
      const then = block('elseif', 'else', 'endif'); const elifs = [];
      while (kw('elseif')) { p++; eat('op', '('); const c = expr(); eat('op', ')'); eat('kw', 'then'); elifs.push([c, block('elseif', 'else', 'endif')]); }
      let els = null; if (kw('else')) { p++; els = block('endif'); }
      eat('kw', 'endif'); return { k: 'if', cond, then, elifs, els };
    }
    if (kw('while')) { p++; eat('op', '('); const cond = expr(); eat('op', ')'); eat('kw', 'do'); const body = block('endwhile'); eat('kw', 'endwhile'); return { k: 'while', cond, body }; }
    if (kw('for')) {
      p++; const name = eat('id').v; eat('op', '='); const from = expr(); const down = kw('downto'); p++; const to = expr(); let step = null;
      if (kw('step')) { p++; step = expr(); } eat('kw', 'do'); const body = block('endfor'); eat('kw', 'endfor'); return { k: 'for', name, from, to, step, down, body };
    }
    if (kw('foreach')) { p++; const name = eat('id').v; eat('kw', 'in'); eat('op', '('); const list = [expr()]; while (op(',')) { p++; list.push(expr()); } eat('op', ')'); eat('kw', 'do'); const body = block('endfor'); eat('kw', 'endfor'); return { k: 'foreach', name, list, body }; }
    if (kw('func')) { p++; const name = eat('id').v; eat('op', '('); const params = []; while (!op(')')) { params.push(eat('id').v); if (op(',')) p++; } p++; eat('kw', 'do'); const body = block('endfunc'); eat('kw', 'endfunc'); return { k: 'func', name, params, body }; }
    if (kw('return')) { p++; return { k: 'return', value: peek() && !kw('endfunc') ? expr() : null }; }
    if (kw('break')) { p++; return { k: 'break' }; }
    if (kw('continue')) { p++; return { k: 'continue' }; }
    if (kw('do')) { p++; const body = block('end'); return { k: 'block', body }; }
    const e = expr();
    if (op('=')) { p++; return { k: 'assign', target: e, value: expr() }; }
    return { k: 'expr', e };
  }
  const BIN = [['or', '|'], ['and', '&'], ['==', 'eq', '<>', 'ne'], ['<', '>', '<=', '>=', 'lt', 'gt', 'le', 'ge'], ['+', '-'], ['*', '/']];
  function expr(level = 0) {
    if (level === BIN.length) return unary();
    let left = expr(level + 1);
    for (;;) {
      const t = peek();
      if (!t || !((t.t === 'op' || t.t === 'kw') && BIN[level].includes(t.v))) break;
      p++;
      left = { k: 'bin', op: t.v, a: left, b: expr(level + 1) };
    }
    return left;
  }
  function unary() {
    if (op('-')) { p++; return { k: 'neg', e: unary() }; }
    if (op('+')) { p++; return unary(); }
    if (kw('not')) { p++; return { k: 'not', e: unary() }; }
    return primary();
  }
  function primary() {
    const t = peek();
    if (!t) throw new Error('FormCalc: unexpected end');
    if (t.t === 'num' || t.t === 'str') { p++; return { k: 'lit', v: t.v }; }
    if (kw('null')) { p++; if (op('(') && toks[p + 1]?.t === 'op' && toks[p + 1].v === ')') p += 2; return { k: 'lit', v: null }; }   // null and Null()
    if (op('(')) { p++; const e = expr(); eat('op', ')'); return e; }
    if (t.t === 'id') {
      p++;
      if (op('(')) {   // a function call (built-in, user function, or a method: Table.Row.instanceManager.count())
        p++; const args = [];
        while (!op(')')) { args.push(expr()); if (op(',')) p++; }
        p++;
        return { k: 'call', name: t.v, args };
      }
      return { k: 'som', path: t.v };
    }
    throw new Error(`FormCalc: unexpected ${JSON.stringify(t.v)}`);
  }
  const out = [];
  while (peek()) out.push(statement());
  return out;
}

// ---- values
const isNull = v => v === null || v === undefined || v === '';
const num = v => { if (isNull(v)) return 0; if (typeof v === 'number') return v; if (typeof v === 'boolean') return v ? 1 : 0; const n = Number(String(v).trim()); return Number.isFinite(n) ? n : 0; };
const str = v => (isNull(v) ? '' : typeof v === 'number' ? String(Math.round(v * 1e8) / 1e8) : String(v));
const truthy = v => (typeof v === 'string' && v !== '' && !Number.isFinite(Number(v)) ? true : num(v) !== 0);
const DAY = 86400000, EPOCH = Date.UTC(1900, 0, 1);
const date2num = (s) => { const m = /^(\d{4})-?(\d{2})-?(\d{2})/.exec(String(s || '')); return m ? Math.round((Date.UTC(+m[1], +m[2] - 1, +m[3]) - EPOCH) / DAY) + 1 : 0; };
const num2iso = n => new Date(EPOCH + (num(n) - 1) * DAY).toISOString().slice(0, 10);

export function formcalcFunctions({ format, parse: parsePic, locale = 'en_US' } = {}) {
  const flat = args => args.flatMap(a => (Array.isArray(a) ? a : [a]));
  const vals = args => flat(args).filter(v => !isNull(v));
  return {
    sum: (...a) => vals(a).reduce((s, v) => s + num(v), 0),
    avg: (...a) => { const v = vals(a); return v.length ? v.reduce((s, x) => s + num(x), 0) / v.length : null; },
    count: (...a) => vals(a).length,
    max: (...a) => { const v = vals(a); return v.length ? Math.max(...v.map(num)) : null; },
    min: (...a) => { const v = vals(a); return v.length ? Math.min(...v.map(num)) : null; },
    abs: v => (isNull(v) ? null : Math.abs(num(v))),
    round: (v, d = 0) => { if (isNull(v)) return null; const f = 10 ** num(d); return Math.round((num(v) + Math.sign(num(v)) * 1e-9) * f) / f; },
    ceil: v => Math.ceil(num(v)), floor: v => Math.floor(num(v)), mod: (a, b) => num(a) % num(b),
    concat: (...a) => flat(a).map(str).join(''),
    upper: v => str(v).toUpperCase(), lower: v => str(v).toLowerCase(), len: v => str(v).length,
    left: (s, n) => str(s).slice(0, Math.max(0, num(n))), right: (s, n) => (num(n) <= 0 ? '' : str(s).slice(-num(n))),
    substr: (s, start, n) => str(s).substr(Math.max(0, num(start) - 1), num(n)),
    ltrim: v => str(v).replace(/^\s+/, ''), rtrim: v => str(v).replace(/\s+$/, ''),
    replace: (s, a, b = '') => str(s).split(str(a)).join(str(b)),
    stuff: (s, start, n, ins = '') => { const x = str(s), i = Math.max(0, num(start) - 1); return x.slice(0, i) + str(ins) + x.slice(i + num(n)); },
    at: (s, sub) => str(s).indexOf(str(sub)) + 1,
    space: n => ' '.repeat(Math.max(0, num(n))),
    str: (v, w = 10, d = 0) => { const s = num(v).toFixed(num(d)); return s.length > num(w) ? '*'.repeat(num(w)) : s.padStart(num(w)); },
    hasvalue: v => (isNull(v) || String(v).trim() === '' ? 0 : 1),
    exists: v => (v === undefined ? 0 : 1),
    oneof: (v, ...list) => (flat(list).some(x => str(x) === str(v)) ? 1 : 0),
    within: (v, lo, hi) => { const x = typeof v === 'number' || Number.isFinite(Number(v)) ? num(v) : str(v); return x >= (typeof x === 'number' ? num(lo) : str(lo)) && x <= (typeof x === 'number' ? num(hi) : str(hi)) ? 1 : 0; },
    choose: (n, ...list) => flat(list)[num(n) - 1] ?? '',
    if: (c, a, b) => (truthy(c) ? a : b),
    // ---- date and time: dates are days since 1 Jan 1900 (= 1), times milliseconds since midnight GMT
    date: () => Math.round((Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate()) - EPOCH) / DAY) + 1,
    time: () => Date.now(),
    date2num: (d, f, k) => { const v = parseDatePic(d, f ?? dateFmt(2, k || locale), k || locale); return v ? dayNum(v) : 0; },
    isodate2num: s => date2num(s),
    isotime2num: s => isoTime(s),
    time2num: (t, f, k) => { const v = parseTimePic(t, f ?? timeFmt(2, k || locale), k || locale); return v === null ? 0 : v; },
    num2date: (n, f, k) => (num(n) < 1 ? '' : (format || fmt)(num2iso(n), `date{${f ?? dateFmt(2, k || locale)}}`, k || locale, 'date')),
    num2gmtime: (n, f, k) => (num(n) < 1 ? '' : fmt(msTime(num(n)), `time{${f ?? timeFmt(2, k || locale)}}`, k || locale, 'time')),
    num2time: (n, f, k) => (num(n) < 1 ? '' : fmt(msTime(num(n)), `time{${f ?? timeFmt(2, k || locale)}}`, k || locale, 'time')),
    datefmt: (n = 0, k) => dateFmt(num(n), k || locale),
    localdatefmt: (n = 0, k) => dateFmt(num(n), k || locale),
    timefmt: (n = 0, k) => timeFmt(num(n), k || locale),
    localtimefmt: (n = 0, k) => timeFmt(num(n), k || locale),
    // ---- strings
    format: (pic, ...v) => flat(v).map(x => (format ? format(x, str(pic), locale) : fmt(x, str(pic), locale))).join(''),
    parse: (pic, v) => (parsePic ? parsePic(pic, v) : parsePicture(str(pic), str(v), locale)),
    wordnum: (n, f = 0) => wordNumF(num(n), num(f)),
    uuid: (n = 0) => { const h = [...Array(32)].map(() => Math.floor(Math.random() * 16).toString(16)).join(''); return num(n) ? `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}` : h; },
    encode: (v, type = 'url') => encode(str(v), str(type).toLowerCase()),
    decode: (v, type = 'url') => decode(str(v), str(type).toLowerCase()),
    // ---- miscellaneous
    null: () => null,
    unittype: v => { const m = /(in|inches|cm|centimeters|mm|millimeters|pt|points|mp|millipoints)\s*$/i.exec(str(v).trim()); return m ? ({ inches: 'in', centimeters: 'cm', millimeters: 'mm', points: 'pt', millipoints: 'mp' }[m[1].toLowerCase()] || m[1].toLowerCase()) : 'in'; },
    unitvalue: (v, u) => { const m = /^\s*(-?[\d.]+)\s*([a-z]*)\s*$/i.exec(str(v)); if (!m) return 0; const from = UNITS[(m[2] || 'in').toLowerCase()] ?? 72; const to = u === undefined ? from : UNITS[str(u).toLowerCase()] ?? 72; return Math.round(Number(m[1]) * from / to * 1e6) / 1e6; },
    // ---- financial
    pmt: (p, r, n) => (num(r) ? num(p) * num(r) / (1 - (1 + num(r)) ** -num(n)) : num(p) / num(n)),
    apr: (p, pay, n) => { const r = rateFor(num(p), num(pay), num(n)); return r === null ? null : r * 12; },
    cterm: (r, fv, pv) => Math.log(num(fv) / num(pv)) / Math.log(1 + num(r)),
    fv: (pay, r, n) => (num(r) ? num(pay) * ((1 + num(r)) ** num(n) - 1) / num(r) : num(pay) * num(n)),
    pv: (pay, r, n) => (num(r) ? num(pay) * (1 - (1 + num(r)) ** -num(n)) / num(r) : num(pay) * num(n)),
    npv: (r, ...v) => flat(v).reduce((s, x, i) => s + num(x) / (1 + num(r)) ** (i + 1), 0),
    rate: (fv, pv, n) => (num(fv) / num(pv)) ** (1 / num(n)) - 1,
    term: (pay, r, fv) => (num(r) ? Math.log(num(fv) * num(r) / num(pay) + 1) / Math.log(1 + num(r)) : num(fv) / num(pay)),
    ipmt: (p, r, pay, first, count) => amortize(num(p), num(r) / 12, num(pay), num(first), num(count)).interest,
    ppmt: (p, r, pay, first, count) => amortize(num(p), num(r) / 12, num(pay), num(first), num(count)).principal,
    // ---- URLs: RAP Studio renders without network access (Adobe's server has none for print either)
    get: () => null, post: () => null, put: () => null,
  };
}
// a picture clause applied with RAP Studio's picture engine
const fmt = (v, pic, loc, kind) => formatPicture(v, /^\w+(\.\w+)?\{/.test(pic) ? pic : guessKind(pic, v), loc, kind || kindOf(pic)) ?? str(v);
const kindOf = pic => (/^date/.test(pic) ? 'date' : /^time/.test(pic) ? 'time' : /^num/.test(pic) ? 'decimal' : 'text');
const guessKind = (pic, v) => (/[YD]/.test(pic) && /\d{4}-?\d{2}-?\d{2}/.test(String(v)) ? `date{${pic}}` : /[z9]/.test(pic) && Number.isFinite(Number(v)) ? `num{${pic}}` : `text{${pic}}`);
const UNITS = { in: 72, cm: 72 / 2.54, mm: 72 / 25.4, pt: 1, mp: 0.001 };
const dayNum = ({ y, m, d }) => Math.round((Date.UTC(y, m - 1, d) - EPOCH) / DAY) + 1;
const msTime = ms => { const t = ((ms % DAY) + DAY) % DAY; const p = n => String(n).padStart(2, '0'); return `${p(Math.floor(t / 3600000))}:${p(Math.floor(t / 60000) % 60)}:${p(Math.floor(t / 1000) % 60)}`; };
// ISO time (13:13:13, 131313, with an offset or Z) -> milliseconds since midnight GMT
function isoTime(s) {
  const m = /^(\d{2}):?(\d{2})(?::?(\d{2})(?:[.,](\d{1,3}))?)?\s*(Z|[+-]\d{2}:?\d{2})?$/.exec(str(s).trim().replace(/^.*T/, ''));
  if (!m) return 0;
  let ms = ((+m[1] * 60 + +m[2]) * 60 + +(m[3] || 0)) * 1000 + +((m[4] || '0').padEnd(3, '0'));
  if (m[5] && m[5] !== 'Z') { const o = /([+-])(\d{2}):?(\d{2})/.exec(m[5]); ms -= (o[1] === '-' ? -1 : 1) * (+o[2] * 60 + +o[3]) * 60000; }
  return ((ms % DAY) + DAY) % DAY;
}
// the locale's date / time formats: 0 default (medium), 1 short, 2 medium, 3 long, 4 full
const DATE_FMT = {
  en: ['MMM D, YYYY', 'M/D/YY', 'MMM D, YYYY', 'MMMM D, YYYY', 'EEEE, MMMM D, YYYY'],
  en_GB: ['D MMM YYYY', 'DD/MM/YY', 'D MMM YYYY', 'D MMMM YYYY', 'EEEE, D MMMM YYYY'],
  de: ['DD.MM.YYYY', 'DD.MM.YY', 'DD.MM.YYYY', 'D. MMMM YYYY', 'EEEE, D. MMMM YYYY'],
  fr: ['D MMM YYYY', 'DD/MM/YY', 'D MMM YYYY', 'D MMMM YYYY', 'EEEE D MMMM YYYY'],
  es: ['D MMM YYYY', 'D/M/YY', 'D MMM YYYY', "D 'de' MMMM 'de' YYYY", "EEEE, D 'de' MMMM 'de' YYYY"],
  it: ['D MMM YYYY', 'DD/MM/YY', 'D MMM YYYY', 'D MMMM YYYY', 'EEEE D MMMM YYYY'],
  nl: ['D MMM YYYY', 'DD-MM-YY', 'D MMM YYYY', 'D MMMM YYYY', 'EEEE D MMMM YYYY'],
  ja: ['YYYY/MM/DD', 'YY/MM/DD', 'YYYY/MM/DD', 'YYYY年M月D日', 'YYYY年M月D日EEEE'],
};
const TIME_FMT = { en: ['h:MM:SS A', 'h:MM A', 'h:MM:SS A', 'h:MM:SS A Z', 'h:MM:SS A Z'], _24: ['HH:MM:SS', 'HH:MM', 'HH:MM:SS', 'HH:MM:SS Z', 'HH:MM:SS Z'] };
const langOf = k => String(k || 'en_US').replace('-', '_');
const dateFmt = (n, k) => { const l = langOf(k); return (DATE_FMT[l] || DATE_FMT[l.slice(0, 2)] || DATE_FMT.en)[Math.max(0, Math.min(4, Math.floor(n)))]; };
const timeFmt = (n, k) => { const l = langOf(k); return (/^en(_(US|CA|AU|IN|PH))?$/.test(l) ? TIME_FMT.en : TIME_FMT._24)[Math.max(0, Math.min(4, Math.floor(n)))]; };
// a value in a date / time picture -> { y, m, d } / milliseconds
const MONTHS = (k, style) => Array.from({ length: 12 }, (_, m) => new Intl.DateTimeFormat(langOf(k).replace('_', '-'), { month: style, timeZone: 'UTC' }).format(Date.UTC(2024, m, 15)).toLowerCase().replace(/\.$/, ''));
const escRe = t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function pictureRegex(pic, tokens) {
  const groups = [];
  let re = '';
  const p = pic.replace(/^\w+(\.\w+)?\{(.*)\}$/, '$2');
  for (let i = 0; i < p.length;) {
    if (p[i] === "'") { const j = p.indexOf("'", i + 1); re += escRe(j < 0 ? p.slice(i + 1) : p.slice(i + 1, j)); i = j < 0 ? p.length : j + 1; continue; }
    const t = tokens.find(x => p.startsWith(x[0], i));
    if (t) { re += t[1]; if (t[1].startsWith('(')) groups.push(t[0]); i += t[0].length; continue; }
    re += escRe(p[i]); i++;
  }
  return { re: new RegExp(`^\\s*${re}\\s*$`, 'iu'), groups };
}
function parseDatePic(v, pic, k) {
  const s = str(v).trim();
  if (!s) return null;
  const { re, groups } = pictureRegex(String(pic), [['YYYY', '(\\d{4})'], ['YY', '(\\d{2})'], ['MMMM', '(\\p{L}+)'], ['MMM', '(\\p{L}+\\.?)'], ['MM', '(\\d{2})'], ['M', '(\\d{1,2})'], ['DD', '(\\d{2})'], ['D', '(\\d{1,2})'], ['EEEE', '\\p{L}+'], ['EEE', '\\p{L}+\\.?'], ['E', '\\d']]);
  const m = re.exec(s);
  if (!m) { const iso = /^(\d{4})-?(\d{2})-?(\d{2})$/.exec(s); return iso ? { y: +iso[1], m: +iso[2], d: +iso[3] } : null; }
  const o = { y: 1900, m: 1, d: 1 };
  groups.forEach((g, i) => {
    const x = m[i + 1];
    if (g === 'YYYY') o.y = +x; else if (g === 'YY') o.y = +x < 50 ? 2000 + +x : 1900 + +x;
    else if (g === 'MMMM' || g === 'MMM') { const n = x.toLowerCase().replace(/\.$/, ''); const i2 = MONTHS(k, 'long').findIndex(z => z === n || z.startsWith(n)); const i3 = MONTHS(k, 'short').findIndex(z => z === n); o.m = (i2 >= 0 ? i2 : i3) + 1; }
    else if (g === 'MM' || g === 'M') o.m = +x; else if (g === 'DD' || g === 'D') o.d = +x;
  });
  if (!(o.m >= 1 && o.m <= 12 && o.d >= 1 && o.d <= 31)) return null;
  return o;
}
function parseTimePic(v, pic) {
  const s = str(v).trim();
  const { re, groups } = pictureRegex(String(pic), [['HH', '(\\d{2})'], ['H', '(\\d{1,2})'], ['hh', '(\\d{2})'], ['h', '(\\d{1,2})'], ['MM', '(\\d{2})'], ['M', '(\\d{1,2})'], ['SS', '(\\d{2})'], ['S', '(\\d{1,2})'], ['FFF', '(\\d{3})'], ['A', '(AM|PM)'], ['Z', '(Z|[+-]\\d{2}:?\\d{2}|[A-Z]{2,4})']]);
  const m = re.exec(s);
  if (!m) return /^\d{2}:?\d{2}/.test(s) ? isoTime(s) : null;
  let h = 0, mi = 0, se = 0, ms = 0, pm = null;
  groups.forEach((g, i) => { const x = m[i + 1]; if (/^[Hh]/.test(g)) h = +x; else if (/^M/.test(g)) mi = +x; else if (/^S/.test(g)) se = +x; else if (g === 'FFF') ms = +x; else if (g === 'A') pm = /pm/i.test(x); });
  if (pm !== null) h = (h % 12) + (pm ? 12 : 0);
  return ((h * 60 + mi) * 60 + se) * 1000 + ms;
}
// Parse( picture, value ): the value in canonical form (dates YYYY-MM-DD, times HH:MM:SS, numbers plain)
function parsePicture(pic, v, k) {
  if (/^date/.test(pic) || (/[DY]/.test(pic) && !/^(num|text|time)/.test(pic))) { const d = parseDatePic(v, pic, k); return d ? `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}` : ''; }
  if (/^time/.test(pic)) { const t = parseTimePic(v, pic); return t === null ? '' : msTime(t); }
  if (/^num/.test(pic) || /[z9]/.test(pic)) {
    const dec = new Intl.NumberFormat(langOf(k).replace('_', '-')).format(1.5)[1];
    const neg = /-|\(/.test(v);
    const n = Number(str(v).replace(new RegExp(`[^\\d${dec === ',' ? ',' : '.'}]`, 'g'), '').replace(',', '.'));
    return Number.isFinite(n) ? (neg ? -n : n) : '';
  }
  return str(v);
}
// Apr: the periodic rate r with payment = principal * r / (1 - (1 + r)^-n)
function rateFor(p, pay, n) {
  if (!(p > 0 && pay > 0 && n > 0) || pay * n <= p) return pay * n === p ? 0 : null;
  let lo = 1e-12, hi = 1;
  for (let i = 0; i < 200; i++) { const r = (lo + hi) / 2; if (p * r / (1 - (1 + r) ** -n) > pay) hi = r; else lo = r; }
  return (lo + hi) / 2;
}
// IPmt / PPmt: interest and principal paid in months first … first + count - 1 of a loan at a monthly rate
function amortize(p, r, pay, first, count) {
  let bal = p, interest = 0, principal = 0;
  if (pay <= p * r) return { interest: 0, principal: 0 };
  for (let m = 1; m < first + count && bal > 0; m++) {
    const i = bal * r, pr = Math.min(pay - i, bal);
    if (m >= first) { interest += i; principal += pr; }
    bal -= pr;
  }
  return { interest: Math.round(interest * 100) / 100, principal: Math.round(principal * 100) / 100 };
}
function encode(s, type) {
  if (type === 'html' || type === 'xml') return s.replace(/[&<>"']|[^\x20-\x7e]/gu, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": type === 'xml' ? '&apos;' : '&#39;' }[c] || `&#x${c.codePointAt(0).toString(16)};`));
  return s.replace(/[^A-Za-z0-9\-_.!~*'()]/gu, c => encodeURIComponent(c));
}
function decode(s, type) {
  if (type === 'html' || type === 'xml') return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e) => (e[0] === '#' ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : +e.slice(1)) : { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[e.toLowerCase()]));
  try { return decodeURIComponent(s.replace(/\+/g, ' ')); } catch { return s; }
}
const ONES = ['Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
// WordNum( n, f ): 0 the number, 1 with Dollars, 2 with Dollars And Cents (Adobe's English wording)
function wordNumF(n, f) {
  if (!Number.isFinite(n) || n < 0 || n >= 1e15) return '*';
  const whole = Math.floor(n + 1e-9), cents = Math.round((n - whole) * 100);
  const w = wordNum(whole);
  if (f === 1) return `${w} Dollars`;
  if (f === 2) return `${w} Dollars And ${wordNum(cents)} Cents`;
  return w;
}
function wordNum(n) {
  if (n < 20) return ONES[n];
  if (n < 100) return TENS[Math.floor(n / 10)] + (n % 10 ? `-${ONES[n % 10].toLowerCase()}` : '');
  for (const [v, w] of [[1e12, 'Trillion'], [1e9, 'Billion'], [1e6, 'Million'], [1e3, 'Thousand'], [100, 'Hundred']]) if (n >= v) return `${wordNum(Math.floor(n / v))} ${w}${n % v ? ` ${wordNum(n % v)}` : ''}`;
  return String(n);
}

class Flow { constructor(kind, value) { this.kind = kind; this.value = value; } }

// run a FormCalc script; env: { som(path) -> value(s) or accessor, assign(path, value), fns }
export function runFormCalc(src, env) {
  const ast = parse(src);
  const fns = { ...formcalcFunctions(env), ...(env.fns || {}) };
  const user = {};
  const scopes = [new Map()];
  const lookupVar = name => { for (let i = scopes.length - 1; i >= 0; i--) if (scopes[i].has(name)) return scopes[i]; return null; };
  const value = e => {
    switch (e.k) {
      case 'lit': return e.v;
      case 'neg': return -num(value(e.e));
      case 'not': return truthy(value(e.e)) ? 0 : 1;
      case 'bin': {
        if (e.op === 'or' || e.op === '|') return truthy(value(e.a)) || truthy(value(e.b)) ? 1 : 0;
        if (e.op === 'and' || e.op === '&') return truthy(value(e.a)) && truthy(value(e.b)) ? 1 : 0;
        const a = value(e.a), b = value(e.b);
        switch (e.op) {
          case '+': return isNull(a) && isNull(b) ? null : num(a) + num(b);
          case '-': return isNull(a) && isNull(b) ? null : num(a) - num(b);
          case '*': return isNull(a) && isNull(b) ? null : num(a) * num(b);
          case '/': { if (isNull(a) && isNull(b)) return null; if (num(b) === 0) throw new Error('FormCalc: division by zero'); return num(a) / num(b); }
          default: {
            // comparisons: numbers when both are numbers, else strings; null equals null / empty
            const both = (typeof a === 'number' || (!isNull(a) && Number.isFinite(Number(a)))) && (typeof b === 'number' || (!isNull(b) && Number.isFinite(Number(b))));
            const x = both ? num(a) : str(a), y = both ? num(b) : str(b);
            const r = { '==': x === y, eq: x === y, '<>': x !== y, ne: x !== y, '<': x < y, lt: x < y, '>': x > y, gt: x > y, '<=': x <= y, le: x <= y, '>=': x >= y, ge: x >= y }[e.op];
            return r ? 1 : 0;
          }
        }
      }
      case 'som': {
        const v = lookupVar(e.path);
        if (v) return v.get(e.path);
        return env.som(e.path);
      }
      case 'call': {
        const lname = e.name.toLowerCase();
        if (user[lname]) {
          const f = user[lname];
          scopes.push(new Map(f.params.map((pn, i) => [pn, value(e.args[i] || { k: 'lit', v: null })])));
          try { const r = runBlock(f.body); return r instanceof Flow ? r.value : r; } finally { scopes.pop(); }
        }
        // a method of a form object: X.Y.instanceManager.count() / .addInstance() / resolveNode(…)
        // Eval: a FormCalc expression in a string; Ref / Exists: the object itself; URL functions: no network
        if (lname === 'eval') return runFormCalc(str(value(e.args[0] || { k: 'lit', v: '' })), env);
        if (lname === 'ref' && e.args[0]?.k === 'som') return env.som(e.args[0].path, { ref: true }) ?? null;
        if (lname === 'exists' && e.args[0]?.k === 'som' && !lookupVar(e.args[0].path)) { try { const r = env.som(e.args[0].path, { ref: true }); return r === undefined || r === null ? 0 : 1; } catch { return 0; } }
        if (/^(get|post|put)$/.test(lname) && !user[lname]) { env.warn?.(`FormCalc ${e.name}: no network access when the form is rendered; null is used`); return null; }
        if (e.name.includes('.')) return env.call(e.name, e.args.map(a => (a.k === 'som' && !lookupVar(a.path) ? env.som(a.path, { ref: true }) : value(a))));
        if (fns[lname]) return fns[lname](...e.args.map(a => (a.k === 'som' && /\[\*\]|\.\./.test(a.path) ? env.som(a.path, { all: true }) : value(a))));
        if (env.call) return env.call(e.name, e.args.map(a => value(a)));
        throw new Error(`FormCalc: unknown function ${e.name}`);
      }
      default: throw new Error(`FormCalc: ${e.k}`);
    }
  };
  function runBlock(list) {
    let last = null;
    for (const st of list) {
      const r = exec(st);
      if (r instanceof Flow) return r;
      last = r;
    }
    return last;
  }
  function exec(st) {
    switch (st.k) {
      case 'var': scopes.at(-1).set(st.name, st.init ? value(st.init) : ''); return scopes.at(-1).get(st.name);
      case 'assign': {
        const v = value(st.value);
        if (st.target.k === 'som') {
          const sc = lookupVar(st.target.path);
          if (sc) sc.set(st.target.path, v); else env.assign(st.target.path, v);
        }
        return v;
      }
      case 'expr': return value(st.e);
      case 'if': {
        if (truthy(value(st.cond))) return runBlock(st.then);
        for (const [c, b] of st.elifs) if (truthy(value(c))) return runBlock(b);
        return st.els ? runBlock(st.els) : null;
      }
      case 'while': { let last = null, n = 0; while (truthy(value(st.cond))) { if (++n > 100000) throw new Error('FormCalc: endless loop'); const r = runBlock(st.body); if (r instanceof Flow) { if (r.kind === 'break') break; if (r.kind === 'return') return r; continue; } last = r; } return last; }
      case 'for': {
        const step = st.step ? num(value(st.step)) : 1, to = num(value(st.to));
        scopes.at(-1).set(st.name, num(value(st.from)));
        let last = null;
        for (let n = 0; st.down ? scopes.at(-1).get(st.name) >= to : scopes.at(-1).get(st.name) <= to; n++) {
          if (n > 100000) throw new Error('FormCalc: endless loop');
          const r = runBlock(st.body);
          if (r instanceof Flow) { if (r.kind === 'break') break; if (r.kind === 'return') return r; } else last = r;
          scopes.at(-1).set(st.name, scopes.at(-1).get(st.name) + (st.down ? -step : step));
        }
        return last;
      }
      case 'foreach': {
        let last = null;
        const items = st.list.flatMap(e => { const v = e.k === 'som' ? env.som(e.path, { all: true }) : value(e); return Array.isArray(v) ? v : [v]; });
        for (const it of items) { scopes.at(-1).set(st.name, it); const r = runBlock(st.body); if (r instanceof Flow) { if (r.kind === 'break') break; if (r.kind === 'return') return r; } else last = r; }
        return last;
      }
      case 'func': user[st.name.toLowerCase()] = st; return null;
      case 'return': return new Flow('return', st.value ? value(st.value) : null);
      case 'break': return new Flow('break');
      case 'continue': return new Flow('continue');
      case 'block': return runBlock(st.body);
      default: return null;
    }
  }
  const r = runBlock(ast);
  return r instanceof Flow ? r.value : r;
}

// the parser, for translating FormCalc into the JavaScript of a fillable PDF (acrobat.js)
export { parse as parseFormCalc };
