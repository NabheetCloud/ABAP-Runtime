// XFA scripts in a fillable PDF: an XDP's calculate, validate and event scripts (JavaScript and FormCalc) become
// the JavaScript actions of the AcroForm fields (Acrobat, Chrome / PDFium, pdf.js run them while the user types).
// - JavaScript: the script runs as written, inside with( scope ): the names it uses are resolved when the PDF is
//   made (SOM: siblings, ancestors, subform children, instances) and stand for proxies of the PDF's fields
//   (rawValue, value, formattedValue, isNull, presence, access, fillColor, all, instanceManager.count)
// - FormCalc: translated to JavaScript (operators with FormCalc's null and number / string rules, if / while /
//   for / foreach / func, the common built-in functions); SOM references become the fields they resolve to
// - calculate -> the field's calculation (C, in the order of the document); validate -> V (event.rc);
//   change -> K (keystroke), exit -> Bl, enter -> Fo, click -> U; initialize / ready / prePrint ran when the PDF
//   was made and are not repeated.
import { parseFormCalc } from './formcalc.js';

// document-level JavaScript: the field proxies, the FormCalc runtime (ES5: Acrobat's engine)
export const ACROBAT_PRELUDE = String.raw`
function $num(v) { if (v === null || v === undefined || v === '') return 0; if (typeof v === 'number') return v; var n = Number(String(v).replace(/,/g, '')); return isNaN(n) ? 0 : n; }
function $def(o, k, get, set) { Object.defineProperty(o, k, { get: get, set: set || function () {}, configurable: true, enumerable: true }); }
function $isnull(v) { return v === null || v === undefined || v === ''; }
function $fld(doc, name, dflt) {
  var f = doc.getField(name), o = { name: name };
  var get = function () { if (!f) return dflt === undefined ? null : dflt; var v = f.value; if (f.type == 'checkbox') return v == 'Off' ? 0 : 1; if (f.type == 'radiobutton') return v == 'Off' ? null : v; if (v === '' || v === null || v === undefined) return null; return v; };
  var set = function (v) { if (!f) return; if (f.type == 'checkbox') { f.checkThisBox(0, v !== null && v !== 0 && v !== '0' && v !== ''); return; } f.value = (v === null || v === undefined) ? '' : v; };
  $def(o, 'rawValue', get, set);
  $def(o, 'value', get, set);
  $def(o, 'formattedValue', function () { return f ? f.valueAsString : String(dflt === undefined || dflt === null ? '' : dflt); }, set);
  $def(o, 'isNull', function () { return $isnull(get()); });
  $def(o, 'presence', function () { return f && f.display == display.hidden ? 'hidden' : 'visible'; }, function (v) { if (f) f.display = (v == 'hidden' || v == 'invisible' || v == 'inactive') ? display.hidden : display.visible; });
  $def(o, 'access', function () { return f && f.readonly ? 'readOnly' : 'open'; }, function (v) { if (f) f.readonly = v != 'open'; });
  $def(o, 'mandatory', function () { return f && f.required ? 'error' : 'disabled'; }, function (v) { if (f) f.required = v == 'error'; });
  $def(o, 'fillColor', function () { return ''; }, function (v) { if (!f) return; var p = String(v).split(','); f.fillColor = ['RGB', p[0] / 255, p[1] / 255, p[2] / 255]; });
  o.resolveNode = function () { return null; };
  return o;
}
// the field of the running calculate / validate / keystroke: its value is event.value
function $self(doc, name, dflt) {
  var o = $fld(doc, name, dflt);
  var get = function () { var v = event.value; return (v === '' || v === null || v === undefined) ? null : v; };
  var set = function (v) { event.value = (v === null || v === undefined) ? '' : v; };
  $def(o, 'rawValue', get, set);
  $def(o, 'value', get, set);
  $def(o, 'isNull', function () { return $isnull(get()); });
  return o;
}
function $const(v) { return { rawValue: v, value: v, formattedValue: v === null ? '' : String(v), isNull: $isnull(v), presence: 'visible' }; }
function $list(items) { var a = items.slice(); a.item = function (i) { return a[i]; }; return a; }
if (typeof xfa == 'undefined') var xfa = { host: { messageBox: function (m) { app.alert(String(m)); }, name: 'Acrobat' }, event: {}, layout: { page: function () { return event.target ? event.target.page + 1 : 1; }, pageCount: function () { return this.numPages; } } };
// FormCalc
function $t(v) { if (typeof v === 'string' && v !== '' && isNaN(Number(v))) return true; return $num(v) !== 0; }
function $ar(op, a, b) { if ($isnull(a) && $isnull(b)) return null; var x = $num(a), y = $num(b); return op == '+' ? x + y : op == '-' ? x - y : op == '*' ? x * y : (y === 0 ? null : x / y); }
function $cmp(op, a, b) {
  var numA = typeof a === 'number' || (!$isnull(a) && !isNaN(Number(a))), numB = typeof b === 'number' || (!$isnull(b) && !isNaN(Number(b)));
  var x = numA && numB ? $num(a) : ($isnull(a) ? '' : String(a)), y = numA && numB ? $num(b) : ($isnull(b) ? '' : String(b));
  var r = op == 'eq' ? x === y : op == 'ne' ? x !== y : op == 'lt' ? x < y : op == 'gt' ? x > y : op == 'le' ? x <= y : x >= y;
  return r ? 1 : 0;
}
function $flat(args) { var out = []; for (var i = 0; i < args.length; i++) { var a = args[i]; if (a && typeof a === 'object' && a.length !== undefined) { for (var j = 0; j < a.length; j++) out.push(a[j]); } else out.push(a); } return out; }
function $vals(args) { var f = $flat(args), out = []; for (var i = 0; i < f.length; i++) if (!$isnull(f[i])) out.push(f[i]); return out; }
function $str(v) { return $isnull(v) ? '' : String(v); }
var $fc = {
  sum: function () { var v = $vals(arguments), s = 0; for (var i = 0; i < v.length; i++) s += $num(v[i]); return s; },
  avg: function () { var v = $vals(arguments); if (!v.length) return null; return $fc.sum(v) / v.length; },
  count: function () { return $vals(arguments).length; },
  max: function () { var v = $vals(arguments); if (!v.length) return null; var m = $num(v[0]); for (var i = 1; i < v.length; i++) m = Math.max(m, $num(v[i])); return m; },
  min: function () { var v = $vals(arguments); if (!v.length) return null; var m = $num(v[0]); for (var i = 1; i < v.length; i++) m = Math.min(m, $num(v[i])); return m; },
  abs: function (v) { return $isnull(v) ? null : Math.abs($num(v)); },
  round: function (v, d) { if ($isnull(v)) return null; var f = Math.pow(10, $num(d)); return Math.round(($num(v) + ($num(v) < 0 ? -1e-9 : 1e-9)) * f) / f; },
  ceil: function (v) { return Math.ceil($num(v)); }, floor: function (v) { return Math.floor($num(v)); }, mod: function (a, b) { return $num(a) % $num(b); },
  concat: function () { var f = $flat(arguments), s = ''; for (var i = 0; i < f.length; i++) s += $str(f[i]); return s; },
  upper: function (v) { return $str(v).toUpperCase(); }, lower: function (v) { return $str(v).toLowerCase(); }, len: function (v) { return $str(v).length; },
  left: function (s, n) { return $str(s).substr(0, Math.max(0, $num(n))); }, right: function (s, n) { var t = $str(s); return $num(n) <= 0 ? '' : t.substr(Math.max(0, t.length - $num(n))); },
  substr: function (s, a, n) { return $str(s).substr(Math.max(0, $num(a) - 1), $num(n)); },
  ltrim: function (v) { return $str(v).replace(/^\s+/, ''); }, rtrim: function (v) { return $str(v).replace(/\s+$/, ''); },
  replace: function (s, a, b) { return $str(s).split($str(a)).join($str(b)); }, at: function (s, t) { return $str(s).indexOf($str(t)) + 1; },
  space: function (n) { var s = ''; for (var i = 0; i < $num(n); i++) s += ' '; return s; },
  hasvalue: function (v) { return $isnull(v) || $str(v).replace(/\s/g, '') === '' ? 0 : 1; },
  oneof: function (v) { var l = $flat(Array.prototype.slice.call(arguments, 1)); for (var i = 0; i < l.length; i++) if ($str(l[i]) === $str(v)) return 1; return 0; },
  within: function (v, lo, hi) { return $num(v) >= $num(lo) && $num(v) <= $num(hi) ? 1 : 0; },
  choose: function (n) { var l = $flat(Array.prototype.slice.call(arguments, 1)); var x = l[$num(n) - 1]; return x === undefined ? '' : x; },
  'if': function (c, a, b) { return $t(c) ? a : b; },
  str: function (v, w, d) { return $num(v).toFixed($isnull(d) ? 0 : $num(d)); },
  date: function () { var d = new Date(); return Math.round((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - Date.UTC(1900, 0, 1)) / 864e5) + 1; },
  date2num: function (s) { var m = /^(\d{4})-?(\d{2})-?(\d{2})/.exec($str(s)); return m ? Math.round((Date.UTC(+m[1], +m[2] - 1, +m[3]) - Date.UTC(1900, 0, 1)) / 864e5) + 1 : 0; },
  isodate2num: function (s) { return $fc.date2num(s); },
  num2date: function (n) { var d = new Date(Date.UTC(1900, 0, 1) + ($num(n) - 1) * 864e5); var p = function (x) { return (x < 10 ? '0' : '') + x; }; return d.getUTCFullYear() + '-' + p(d.getUTCMonth() + 1) + '-' + p(d.getUTCDate()); },
  pmt: function (p, r, n) { p = $num(p); r = $num(r); n = $num(n); return r ? p * r / (1 - Math.pow(1 + r, -n)) : p / n; },
  'null': function () { return null; }
};
// display pattern of a numeric field: num{z,zzz,zz9.99}
function $fmtNum(v, dec, group, dsep, gsep) {
  if ($isnull(v) || isNaN(Number(v))) return $isnull(v) ? '' : String(v);
  var s = Math.abs(Number(v)).toFixed(dec), p = s.split('.'), i = p[0];
  if (group) i = i.replace(/\B(?=(\d{3})+(?!\d))/g, gsep);
  return (Number(v) < 0 ? '-' : '') + i + (dec ? dsep + p[1] : '');
}
`;

// FormCalc -> JavaScript; ref(path, { all, write }) gives the JavaScript of a SOM reference
export function formcalcToJs(src, ref) {
  const ast = parseFormCalc(src);
  const vars = [new Set()];
  const isVar = n => vars.some(s => s.has(n));
  const id = n => `v_${String(n).replace(/[^\w]/g, '_')}`;
  const OPS = { '==': 'eq', eq: 'eq', '<>': 'ne', ne: 'ne', '<': 'lt', lt: 'lt', '>': 'gt', gt: 'gt', '<=': 'le', le: 'le', '>=': 'ge', ge: 'ge' };
  const e = x => {
    switch (x.k) {
      case 'lit': return JSON.stringify(x.v);
      case 'neg': return `(-$num(${e(x.e)}))`;
      case 'not': return `($t(${e(x.e)}) ? 0 : 1)`;
      case 'bin':
        if (x.op === 'or' || x.op === '|') return `(($t(${e(x.a)}) || $t(${e(x.b)})) ? 1 : 0)`;
        if (x.op === 'and' || x.op === '&') return `(($t(${e(x.a)}) && $t(${e(x.b)})) ? 1 : 0)`;
        if (OPS[x.op]) return `$cmp('${OPS[x.op]}', ${e(x.a)}, ${e(x.b)})`;
        return `$ar('${x.op}', ${e(x.a)}, ${e(x.b)})`;
      case 'som': return isVar(x.path) ? id(x.path) : ref(x.path, {});
      case 'call': {
        const name = x.name.toLowerCase();
        if (userFns.has(name)) return `u_${name}(${x.args.map(e).join(', ')})`;
        if (x.name.includes('.')) return 'null';   // methods of form objects (instance managers) are not available in the PDF
        const args = x.args.map(a => (a.k === 'som' && !isVar(a.path) && /\[\*\]|\.\./.test(a.path) ? ref(a.path, { all: true }) : e(a)));
        return `($fc[${JSON.stringify(name)}] ? $fc[${JSON.stringify(name)}](${args.join(', ')}) : null)`;
      }
      default: return 'null';
    }
  };
  const userFns = new Set();
  (function collect(list) { for (const s of list) { if (s.k === 'func') userFns.add(s.name.toLowerCase()); } })(ast);
  let loop = 0;
  const st = (s, ind) => {
    switch (s.k) {
      case 'var': vars.at(-1).add(s.name); return `${ind}var ${id(s.name)} = ${s.init ? e(s.init) : "''"}; __l = ${id(s.name)};`;
      case 'assign': {
        const v = e(s.value);
        if (s.target.k === 'som' && isVar(s.target.path)) return `${ind}${id(s.target.path)} = ${v}; __l = ${id(s.target.path)};`;
        return `${ind}__l = ${v}; ${ref(s.target.path, { write: '__l' })};`;
      }
      case 'expr': return `${ind}__l = ${e(s.e)};`;
      case 'if': return `${ind}if ($t(${e(s.cond)})) {\n${block(s.then, ind)}\n${ind}}${s.elifs.map(([c, b]) => ` else if ($t(${e(c)})) {\n${block(b, ind)}\n${ind}}`).join('')}${s.els ? ` else {\n${block(s.els, ind)}\n${ind}}` : ''}`;
      case 'while': { const g = `__g${loop++}`; return `${ind}var ${g} = 0; while ($t(${e(s.cond)}) && ${g}++ < 100000) {\n${block(s.body, ind)}\n${ind}}`; }
      case 'for': {
        vars.at(-1).add(s.name);
        const step = s.step ? `$num(${e(s.step)})` : '1';
        return `${ind}for (var ${id(s.name)} = $num(${e(s.from)}); ${s.down ? `${id(s.name)} >= $num(${e(s.to)})` : `${id(s.name)} <= $num(${e(s.to)})`}; ${id(s.name)} ${s.down ? '-=' : '+='} ${step}) {\n${block(s.body, ind)}\n${ind}}`;
      }
      case 'foreach': {
        vars.at(-1).add(s.name);
        const a = `__a${loop++}`;
        return `${ind}var ${a} = $flat([${s.list.map(x => (x.k === 'som' && !isVar(x.path) ? ref(x.path, { all: true }) : e(x))).join(', ')}]);\n${ind}for (var ${a}i = 0; ${a}i < ${a}.length; ${a}i++) { var ${id(s.name)} = ${a}[${a}i];\n${block(s.body, ind)}\n${ind}}`;
      }
      case 'func': {
        vars.push(new Set(s.params));
        const body = block(s.body, ind);
        vars.pop();
        return `${ind}function u_${s.name.toLowerCase()}(${s.params.map(id).join(', ')}) { var __l = null;\n${body}\n${ind}return __l; }`;
      }
      case 'return': return `${ind}return ${s.value ? e(s.value) : 'null'};`;
      case 'break': return `${ind}break;`;
      case 'continue': return `${ind}continue;`;
      case 'block': return block(s.body, ind);
      default: return '';
    }
  };
  const block = (list, ind) => list.map(s => st(s, `${ind}  `)).join('\n');
  return `var __l = null;\n${block(ast, '')}\nreturn __l;`;
}

// the format action of a field with a numeric display pattern (num{z,zzz,zz9.99})
export function numberFormat(picture, locale = 'en_US') {
  const m = /num(?:\.\w+)?\{([^}]*)\}/.exec(String(picture || ''));
  if (!m) return null;
  const body = m[1].replace(/'[^']*'/g, '');
  const dec = (/[.vV]([z9Z]+)/.exec(body)?.[1] || '').length;
  const group = body.includes(',');
  const de = /^(de|fr|es|it|nl|pt|da|sv|nb|fi|pl|cs|ru|tr)/i.test(locale);
  return `event.value = $fmtNum(event.value, ${dec}, ${group}, ${JSON.stringify(de ? ',' : '.')}, ${JSON.stringify(de ? '.' : ',')});`;
}
