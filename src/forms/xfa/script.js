// The XFA script runtime: the merged form (one node per instance of a subform, field, draw, exclusion group) as the
// XFA object model, with SOM resolution, and scripts in JavaScript (a node:vm sandbox) and FormCalc (formcalc.js).
// Events run the way Adobe's server does for print: initialize, calculate (until values settle), validate,
// form:ready, docReady, prePrint; layout:ready and page-number calculations of page areas run per page.
// Form node: { tpl (a per-instance copy of the template node: presence and colours set by scripts go there), orig,
// ctx (data node), parent, kids, val ({ raw, dn, vk } of fields) }.
import vm from 'node:vm';
import { runFormCalc } from './formcalc.js';
import { formcalcToJs } from './acrobat.js';

const NUMERIC = new Set(['decimal', 'float', 'integer']);
const kid = (n, tag) => (n?.kids || []).find(k => k.tag === tag);
const kidsOf = (n, tag) => (n?.kids || []).filter(k => k.tag === tag);
const deepText = n => (n ? n.text + n.kids.map(deepText).join('') : '');
const CONTAINERS = new Set(['subform', 'area', 'exclGroup', 'field', 'draw', 'pageArea', 'subformSet']);

export function scriptsOf(tpl) {
  const out = [];
  const calc = kid(kid(tpl, 'calculate'), 'script');
  if (calc && deepText(calc).trim()) out.push({ activity: 'calculate', script: calc });
  const val = kid(kid(tpl, 'validate'), 'script');
  if (val && deepText(val).trim()) out.push({ activity: 'validate', script: val });
  for (const e of kidsOf(tpl, 'event')) {
    const s = kid(e, 'script');
    if (s && deepText(s).trim()) out.push({ activity: e.a.activity || 'click', ref: e.a.ref || '$', script: s });
  }
  return out;
}
export const hasScripts = tpl => scriptsOf(tpl).length > 0;
export const usesLayout = src => /layout\.(page|pageCount|absPage|absPageCount|sheet|sheetCount|pageSpan)\b|\$layout|numPages|currentPage/.test(src);

export function createScriptHost({ root, record, locale = 'en_US', warn = () => {}, display, merge, page = () => ({ page: 1, pages: 1 }), geometry = null }) {
  const proxies = new WeakMap();
  const nodeOf = new WeakMap();   // proxy -> form node
  const dataProxies = new WeakMap();

  // ---- the form tree
  const nameOf = fn => fn.tpl.a.name || '';
  const isContainer = fn => CONTAINERS.has(fn.tpl.tag);
  // the children of a node by name; unnamed subforms are transparent (their children count as the parent's)
  function childrenNamed(fn, name) {
    const out = [];
    for (const k of fn.kids || []) {
      if (nameOf(k) === name) out.push(k);
      else if (!nameOf(k) && (k.tpl.tag === 'subform' || k.tpl.tag === 'area' || k.tpl.tag === 'subformSet')) out.push(...childrenNamed(k, name));
    }
    return out;
  }
  const descendants = (fn, name, out = []) => { for (const k of fn.kids || []) { if (nameOf(k) === name) out.push(k); descendants(k, name, out); } return out; };
  // script objects and named variables of a subform (<variables><script name=…>, <text name=…>)
  const variables = (fn, name) => {
    const v = kid(fn.tpl, 'variables');
    const item = v?.kids.find(k => k.a.name === name);
    if (!item) return undefined;
    fn.$vars ||= new Map();
    if (!fn.$vars.has(name)) fn.$vars.set(name, item.tag === 'script' ? scriptObject(fn, item) : { value: deepText(item).trim(), get rawValue() { return this.value; } });
    return fn.$vars.get(name);
  };
  // an unqualified name from a node: its children, then up the ancestors (their children and themselves)
  function scopeFind(fn, name) {
    for (let a = fn; a; a = a.parent) {
      if (a !== fn || isContainer(a)) {
        const hits = childrenNamed(a, name);
        if (hits.length) return hits;
      }
      if (nameOf(a) === name) return [a];
      const v = variables(a, name);
      if (v !== undefined) return [v];
    }
    // not in scope: a unique-enough descendant of the node's subform (Designer forms often rely on this leniency)
    for (let a = fn.parent || fn; a; a = a.parent) { const d = descendants(a, name); if (d.length) return d; }
    return [];
  }

  // ---- SOM: a.b[2].c, $, $record.x, $form, $data, !name, xfa.…, a..b (descendants), [*]
  const SEG = /^(#?[^[\]]+?)(?:\[(\*|[-+]?\d+)\])?$/;
  function resolve(path, from, { all = false } = {}) {
    let p = String(path).trim();
    if (!p) return [];
    const segs = [];
    let i = 0;
    while (i < p.length) {
      let deep = false;
      if (p.startsWith('..', i)) { deep = true; i += 2; } else if (p[i] === '.') i++;
      let j = i, depth = 0;
      while (j < p.length && (depth || p[j] !== '.')) { if (p[j] === '[') depth++; if (p[j] === ']') depth--; j++; }
      segs.push({ text: p.slice(i, j), deep });
      i = j;
    }
    let cur = null;
    for (const [k, s] of segs.entries()) {
      const m = SEG.exec(s.text) || [null, s.text, undefined];
      const name = m[1], idx = m[2];
      let next;
      if (k === 0) {
        if (name === '$' || name === 'this') next = [from];
        else if (name === '$form' || name === 'xfa.form') next = [root];
        else if (name === '$record' || name === '$data') next = [dataProxy(record)];
        else if (name === 'xfa') next = [xfa];
        else if (name === '$layout') next = [xfa.layout];
        else if (name === '$host') next = [xfa.host];
        else if (name === '$event') next = [xfa.event];
        else if (name === '$template') next = [root];
        else if (name.startsWith('!')) next = [dataProxy(record)[name.slice(1)]].filter(v => v !== undefined);
        else if (name === root.tpl.a.name && !from.parent) next = [root];
        else next = scopeFind(from, name);
        if (!next.length && name === nameOf(root)) next = [root];
      } else {
        next = [];
        for (const c of cur) {
          if (c && c.tpl) {
            const hits = s.deep ? descendants(c, name) : childrenNamed(c, name);
            if (hits.length) { next.push(...hits); continue; }
            const v = variables(c, name);
            if (v !== undefined) { next.push(v); continue; }
          }
          const obj = c && c.tpl ? proxyOf(c) : c;
          if (obj !== null && obj !== undefined && name in Object(obj)) next.push(obj[name]);
        }
      }
      if (idx === '*') cur = next;
      else if (idx !== undefined) cur = next.filter(x => x && x.tpl).length ? [next[Number(idx)]].filter(x => x !== undefined) : next.slice(0, 1);
      else {
        // without an index: the instance with the same index as the referencing node's own ancestor (XFA's rule)
        if (next.length > 1 && next[0]?.tpl) {
          const same = next.find(n => n.parent && ancestors(from).includes(n));
          cur = all ? next : [same || next[0]];
        } else cur = all ? next : next.slice(0, 1);
      }
      if (!cur.length) return [];
    }
    return cur;
  }
  const ancestors = fn => { const out = []; for (let a = fn; a; a = a.parent) out.push(a); return out; };

  // ---- values
  const isNumeric = fn => NUMERIC.has(fn.val?.vk?.tag) || kid(kid(fn.tpl, 'ui'), 'numericEdit');
  const rawOf = fn => {
    if (!fn.val) return null;
    const r = fn.val.raw;
    if (r === null || r === undefined || r === '') return null;
    if (isNumeric(fn)) { const n = Number(String(r).trim()); return Number.isFinite(n) ? n : r; }
    return r;
  };
  const setRaw = (fn, v) => {
    if (!fn.val) fn.val = { raw: '', dn: null, vk: null };
    const s = v === null || v === undefined ? '' : typeof v === 'number' ? String(Math.round(v * 1e10) / 1e10) : String(v);
    if (fn.val.raw !== s) { fn.val.raw = s; host.changed = true; }
    if (fn.val.dn) fn.val.dn.text = s;
  };
  const colorOf = c => String(c || '').split(',').map(Number);

  // ---- the object model
  function instanceManager(fn) {
    // the instances: the siblings with the same template
    const sibs = () => (fn.parent?.kids || []).filter(k => k.orig === fn.orig);
    const occ = kid(fn.orig, 'occur');
    const im = {
      get count() { return sibs().length; },
      get min() { return occ?.a.min !== undefined ? Number(occ.a.min) : 1; },
      get max() { return occ?.a.max !== undefined ? Number(occ.a.max) : 1; },
      get name() { return `_${nameOf(fn)}`; },
      addInstance() {
        const list = sibs(), last = list.at(-1) || fn;
        const node = merge(fn.orig, null, fn.parent);
        const kids = fn.parent.kids;
        kids.splice(kids.indexOf(last) + 1, 0, node);
        host.changed = true;
        host.initialize(node);
        return proxyOf(node);
      },
      removeInstance(i) { const t = sibs()[Number(i)]; if (t) { fn.parent.kids.splice(fn.parent.kids.indexOf(t), 1); host.changed = true; } },
      setInstances(n) { while (this.count < n) this.addInstance(); while (this.count > n && this.count > 0) this.removeInstance(this.count - 1); },
      moveInstance(from, to) { const l = sibs(), a = l[from], b = l[to]; if (!a || !b) return; const k = fn.parent.kids; k.splice(k.indexOf(a), 1); k.splice(k.indexOf(b) + (from < to ? 1 : 0), 0, a); },
      insertInstance(i) { const n = this.addInstance(); this.moveInstance(this.count - 1, i); return n; },
    };
    return im;
  }
  const list = arr => Object.assign(arr.slice(), { item: i => arr[i], namedItem: nm => arr.find(x => x?.name === nm) ?? null, get length() { return arr.length; } });

  function proxyOf(fn) {
    if (!fn || !fn.tpl) return fn;
    if (proxies.has(fn)) return proxies.get(fn);
    const t = fn.tpl;
    const base = {
      get name() { return nameOf(fn); },
      get className() { return t.tag; },
      get somExpression() { return somOf(fn); },
      get parent() { return fn.parent ? proxyOf(fn.parent) : null; },
      get index() { return (fn.parent?.kids || []).filter(k => k.orig === fn.orig).indexOf(fn); },
      get nodes() { return list((fn.kids || []).map(proxyOf)); },
      get all() { return list((fn.parent?.kids || []).filter(k => nameOf(k) === nameOf(fn)).map(proxyOf)); },
      get instanceManager() { return instanceManager(fn); },
      get rawValue() { return t.tag === 'draw' ? (fn.val ? rawOf(fn) : deepText(kid(kid(t, 'value'), (kid(t, 'value')?.kids[0] || {}).tag)).trim()) : rawOf(fn); },
      set rawValue(v) { setRaw(fn, v); },
      get value() { return this.rawValue; },
      set value(v) { setRaw(fn, v); },
      get formattedValue() { return display(fn); },
      set formattedValue(v) { setRaw(fn, v); },
      get isNull() { return rawOf(fn) === null; },
      get presence() { return t.a.presence || 'visible'; },
      set presence(v) { if (t.a.presence !== v) { t.a.presence = String(v); host.changed = true; } },
      get relevant() { return t.a.relevant || ''; },
      set relevant(v) { t.a.relevant = String(v); },
      get access() { return t.a.access || 'open'; },
      set access(v) { t.a.access = String(v); },
      get mandatory() { return kid(t, 'validate')?.a.nullTest || 'disabled'; },
      set mandatory(v) {},
      get h() { return t.a.h; }, set h(v) { t.a.h = String(v); },
      get w() { return t.a.w; }, set w(v) { t.a.w = String(v); },
      get x() { return t.a.x; }, set x(v) { t.a.x = String(v); },
      get y() { return t.a.y; }, set y(v) { t.a.y = String(v); },
      get fillColor() { return (t.$fill || []).join(','); },
      set fillColor(v) { t.$fill = colorOf(v); },
      get borderColor() { return (t.$borderColor || []).join(','); },
      set borderColor(v) { t.$borderColor = colorOf(v); },
      get fontColor() { return (t.$fontColor || []).join(','); },
      set fontColor(v) { t.$fontColor = colorOf(v); },
      get caption() { const c = kid(t, 'caption'); return { value: { text: { get value() { return deepText(kid(kid(c, 'value'), 'text')).trim(); }, set value(v) { setCaption(t, v); } } }, get presence() { return c?.a.presence || 'visible'; }, set presence(v) { if (c) c.a.presence = v; } }; },
      get border() { return { fill: { color: { get value() { return (t.$fill || []).join(','); }, set value(v) { t.$fill = colorOf(v); } }, get presence() { return 'visible'; }, set presence(v) { if (v === 'hidden' || v === 'invisible') t.$fill = null; } }, get presence() { return kid(t, 'border')?.a.presence || 'visible'; }, set presence(v) { t.$borderPresence = v; } }; },
      get font() { return { fill: { color: { get value() { return (t.$fontColor || []).join(','); }, set value(v) { t.$fontColor = colorOf(v); } } } }; },
      get validationMessage() { return deepText(kid(kid(t, 'validate'), 'message')).trim(); }, set validationMessage(v) {},
      resolveNode(s) { return resolve(s, fn).map(proxyOf)[0] ?? null; },
      resolveNodes(s) { return list(resolve(s, fn, { all: true }).map(proxyOf)); },
      getAttribute(a) { return t.a[a] ?? ''; },
      setAttribute(v, a) { t.a[a] = String(v); },
      execEvent() {}, execCalculate() { host.runOne(fn, 'calculate'); }, execInitialize() { host.runOne(fn, 'initialize'); }, execValidate() { return true; },
      addItem(display) { (t.$items ||= []).push(String(display)); },
      clearItems() { t.$items = []; },
      boundItem(v) { return v; },
      isPropertySpecified() { return false; },
      toString() { return `[object ${t.tag}]`; },
    };
    // children by name (Lines.Line), _Name: the instance manager of a child
    const px = new Proxy(base, {
      get(o, k) {
        if (k in o || typeof k === 'symbol') return o[k];
        if (k.startsWith('_') && k.length > 1) { const c = childrenNamed(fn, k.slice(1))[0]; if (c) return instanceManager(c); }
        const c = childrenNamed(fn, k)[0];
        if (c) return proxyOf(c);
        const v = variables(fn, k);
        return v;
      },
      set(o, k, v) {
        if (k in o) { o[k] = v; return true; }
        const c = childrenNamed(fn, k)[0];
        if (c) { setRaw(c, v); return true; }
        o[k] = v; return true;
      },
      has(o, k) { return k in o || (typeof k === 'string' && childrenNamed(fn, k).length > 0); },
    });
    proxies.set(fn, px);
    nodeOf.set(px, fn);
    return px;
  }
  const setCaption = (t, v) => { const c = kid(t, 'caption'); const tx = kid(kid(c, 'value'), 'text'); if (tx) { tx.text = String(v); tx.kids = []; } };
  const somOf = fn => { const p = []; for (let a = fn; a; a = a.parent) p.unshift(`${nameOf(a) || `#${a.tpl.tag}`}[${a.parent ? a.parent.kids.filter(k => nameOf(k) === nameOf(a)).indexOf(a) : 0}]`); return `xfa[0].form[0].${p.join('.')}`; };

  // data nodes: name, value, nodes, children by name
  function dataProxy(d) {
    if (!d) return null;
    if (dataProxies.has(d)) return dataProxies.get(d);
    const base = {
      get name() { return d.name; }, get value() { return d.kids.length ? null : d.text; }, set value(v) { d.text = String(v ?? ''); },
      get nodes() { return list(d.kids.map(dataProxy)); }, get parent() { return dataProxy(d.parent); }, get isNull() { return !d.text; },
      get rawValue() { return this.value; },
      resolveNode(s) { const r = resolve(s.replace(/^\$\.?/, ''), root); return r[0] ?? null; },
      toString() { return d.text; },
    };
    const px = new Proxy(base, {
      get(o, k) {
        if (k in o || typeof k === 'symbol') return o[k];
        const c = d.kids.find(x => x.name === k) || d.kids.find(x => x.name.toLowerCase() === String(k).toLowerCase());
        return c ? dataProxy(c) : undefined;
      },
      has(o, k) { return k in o || d.kids.some(x => x.name === k); },
    });
    dataProxies.set(d, px);
    return px;
  }

  // ---- xfa, util, console, event
  const xfa = {
    get form() { return proxyOf(root); },
    get record() { return dataProxy(record); },
    get datasets() { return { data: dataProxy(record) }; },
    get data() { return dataProxy(record); },
    // the layout of the form (a first layout pass gives where every object landed: geometry)
    layout: {
      page: n => { const b = geo(n); return b ? b[0].page + 1 : page().page; },
      pageCount: () => page().pages, absPage: n => { const b = geo(n); return b ? b[0].page : page().page - 1; }, absPageCount: () => page().pages,
      sheet: n => xfa.layout.page(n), sheetCount: () => page().pages,
      pageSpan: n => { const b = geo(n); return b ? new Set(b.map(x => x.page)).size : 1; },
      relayout() {}, relayoutPageArea() {},
      h: (n, u = 'in') => toUnit(geo(n)?.reduce((s, x) => s + x.h, 0) ?? 0, u), w: (n, u = 'in') => toUnit(geo(n)?.[0].w ?? 0, u),
      x: (n, u = 'in') => toUnit(geo(n)?.[0].x ?? 0, u), y: (n, u = 'in') => toUnit(geo(n)?.[0].y ?? 0, u),
      pageContent: (i, cls = '') => list(geometry ? [...geometry.byPage(Number(i))].filter(fn => !cls || fn.tpl.tag === cls).map(proxyOf) : []),
    },
    host: {
      name: 'XFAPresentationAgent', appType: 'Exchange-Pro', platform: 'server', variation: 'Full', version: '11.0', language: locale,
      get numPages() { return page().pages; }, get currentPage() { return page().page - 1; }, set currentPage(v) {},
      messageBox(m) { warn(`Script message: ${m}`); return 1; }, beep() {}, setFocus() {}, resetData() {}, importData() {}, exportData() {}, print() {}, gotoURL() {}, response() { return null; },
    },
    event: { change: '', newText: '', prevText: '', target: null, name: '' },
    resolveNode(s) { return resolve(s, root).map(proxyOf)[0] ?? null; },
    resolveNodes(s) { return list(resolve(s, root, { all: true }).map(proxyOf)); },
    get this() { return null; },
    toString() { return '[object XFAObject]'; },
  };
  // the boxes of a form node in the first layout pass: by its template path and its place among the nodes of that path
  const toUnit = (pt, u) => { const k = String(u).toLowerCase(); return k === 'pt' ? pt : k === 'mm' ? pt * 25.4 / 72 : k === 'cm' ? pt * 2.54 / 72 : pt / 72; };
  const geo = px => {
    if (!geometry) return null;
    const fn = px?.tpl ? px : nodeOf.get(px) || nodeOf.get(px?.$self) || null;
    if (!fn) return null;
    return geometry.of(fn) || null;
  };
  const util = {
    printd(fmt, d) {
      const dt = d instanceof Date ? d : new Date(d);
      const p = (n, l = 2) => String(n).padStart(l, '0');
      const map = { yyyy: dt.getFullYear(), yy: p(dt.getFullYear() % 100), mmmm: dt.toLocaleString('en', { month: 'long' }), mmm: dt.toLocaleString('en', { month: 'short' }), mm: p(dt.getMonth() + 1), m: dt.getMonth() + 1, dd: p(dt.getDate()), d: dt.getDate(), HH: p(dt.getHours()), MM: p(dt.getMinutes()), ss: p(dt.getSeconds()) };
      return String(fmt).replace(/yyyy|yy|mmmm|mmm|mm|m|dd|d|HH|MM|ss/g, t => map[t]);
    },
    printf(fmt, ...a) { let i = 0; return String(fmt).replace(/%(,\d)?\.?(\d+)?([sdfx])/g, (_, c, prec, t) => { const v = a[i++]; if (t === 'd') return String(Math.trunc(Number(v))); if (t === 'f') return Number(v).toFixed(prec ? Number(prec) : 6); if (t === 'x') return Number(v).toString(16); return String(v); }); },
    scand(fmt, s) { const d = new Date(s); return Number.isNaN(d.getTime()) ? null : d; },
  };
  const consoleObj = { println: m => warn(`Script console: ${m}`), show() {}, clear() {} };

  const sandbox = vm.createContext({ xfa, util, console: consoleObj, app: { alert: m => warn(`Script message: ${m}`), get platform() { return 'server'; } }, $record: null });
  sandbox.$record = dataProxy(record);
  // with(scope): unqualified names resolve against the form from the script's node
  const runner = new vm.Script(`(function (__src, __scope) { with (__scope) { return eval(__src); } })`).runInContext(sandbox);
  const GLOBALS = new Set(['xfa', 'util', 'console', 'app', 'event', 'eval', 'undefined', 'NaN', 'Infinity', 'Math', 'Number', 'String', 'Date', 'Array', 'Object', 'JSON', 'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'Boolean', 'RegExp', 'Error']);
  const scopeFor = (fn) => new Proxy({}, {
    has(_, k) {
      if (typeof k !== 'string' || GLOBALS.has(k)) return k === 'event';
      if (k === '$' || k === '$form' || k === '$record' || k === '$data' || k === '$layout' || k === '$host') return true;
      if (k.startsWith('_') && k.length > 1 && scopeFind(fn, k.slice(1)).length) return true;
      return scopeFind(fn, k).length > 0;
    },
    get(_, k) {
      if (k === Symbol.unscopables) return undefined;
      if (k === 'event') return xfa.event;
      if (k === '$') return proxyOf(fn);
      if (k === '$form') return proxyOf(root);
      if (k === '$record' || k === '$data') return dataProxy(record);
      if (k === '$layout') return xfa.layout;
      if (k === '$host') return xfa.host;
      if (k.startsWith('_')) { const c = scopeFind(fn, k.slice(1))[0]; if (c?.tpl) return instanceManager(c); }
      const c = scopeFind(fn, k)[0];
      return c?.tpl ? proxyOf(c) : c;
    },
    set(_, k, v) { const c = scopeFind(fn, k)[0]; if (c?.tpl) setRaw(c, v); return true; },
  });
  function scriptObject(fn, item) {
    const src = deepText(item);
    const names = [...src.matchAll(/function\s+([A-Za-z_$][\w$]*)|(?:^|[;\n\s])(?:var|let|const)\s+([A-Za-z_$][\w$]*)/g)].map(m => m[1] || m[2]);
    try {
      return new vm.Script(`(function (__scope) { with (__scope) { ${src}\n return { ${names.map(n => `${n}: typeof ${n} === 'undefined' ? undefined : ${n}`).join(', ')} }; } })`).runInContext(sandbox, { timeout: 1000 })(scopeFor(fn));
    } catch (e) { warn(`Script object ${item.a.name}: ${e.message}`); return {}; }
  }

  const fcEnv = fn => ({
    locale, warn,
    som(path, o = {}) {
      const r = resolve(path, fn, o);
      if (o.ref) return r[0]?.tpl ? proxyOf(r[0]) : r[0];
      const v = r.map(x => (x?.tpl ? (x.tpl.tag === 'field' || x.tpl.tag === 'draw' ? proxyOf(x).rawValue : null) : x && typeof x === 'object' && 'value' in x ? x.value : x));
      return o.all ? v : v[0] ?? null;
    },
    assign(path, v) {
      const m = /^(.*)\.([A-Za-z_]\w*)$/.exec(path);
      const r = resolve(path, fn);
      if (r[0]?.tpl) return setRaw(r[0], v);
      if (m) { const base = resolve(m[1], fn)[0]; const obj = base?.tpl ? proxyOf(base) : base; if (obj) obj[m[2]] = v; return; }
      throw new Error(`FormCalc: ${path} not found`);
    },
    call(name, args) {
      const i = name.lastIndexOf('.');
      const base = resolve(name.slice(0, i), fn)[0];
      const obj = base?.tpl ? proxyOf(base) : base;
      const f = obj?.[name.slice(i + 1)];
      if (typeof f !== 'function') throw new Error(`FormCalc: ${name} is not a function`);
      return f.apply(obj, args);
    },
  });

  // ---- running scripts
  const label = fn => somOf(fn).replace(/^xfa\[0\]\.form\[0\]\./, '').replace(/\[0\]/g, '');
  function exec(fn, s, activity) {
    const src = deepText(s.script);
    const lang = /javascript/i.test(s.script.a.contentType || '') ? 'js' : 'formcalc';
    try {
      xfa.event = { change: '', newText: '', prevText: '', target: proxyOf(fn), name: activity };
      if (lang === 'js') return runner.call(proxyOf(fn), src, scopeFor(fn));
      return runFormCalc(src, fcEnv(fn));
    } catch (e) {
      warn(`Script error in ${label(fn)} (${activity}): ${e.message}`);
      return undefined;
    }
  }
  const walk = (fn, f) => { f(fn); for (const k of [...(fn.kids || [])]) walk(k, f); };
  const host = {
    changed: false,
    proxyOf, resolve, dataProxy,
    run(fn, activity, { refs = ['$'] } = {}) {
      for (const s of scriptsOf(fn.tpl)) {
        if (s.activity !== activity) continue;
        if (s.ref !== undefined && !refs.includes(s.ref)) continue;
        const r = exec(fn, s, activity);
        if (activity === 'calculate' && r !== undefined && !(typeof r === 'object' && r !== null && !(r instanceof Date))) {
          // the value of the script is the field's value (also when the script set this.rawValue itself)
          if (r !== null || fn.val?.raw) setRaw(fn, r);
        }
        if (activity === 'validate' && (r === false || r === 0)) {
          const msg = deepText(kid(kid(fn.tpl, 'validate'), 'message')).trim();
          warn(`Validation failed: ${label(fn)}${msg ? ` (${msg})` : ''}`);
        }
      }
    },
    runOne(fn, activity) { host.run(fn, activity); },
    initialize(node) { walk(node, fn => host.run(fn, 'initialize')); },
    calculate(node, { skipLayout = false } = {}) {
      for (let pass = 0; pass < 6; pass++) {
        host.changed = false;
        walk(node, fn => {
          if (skipLayout && scriptsOf(fn.tpl).some(s => s.activity === 'calculate' && usesLayout(deepText(s.script)))) return;
          host.run(fn, 'calculate');
        });
        if (!host.changed) break;
      }
    },
    // the events Adobe's server runs before the layout of a print form
    prepare(node) {
      host.initialize(node);
      host.calculate(node, { skipLayout: true });
      walk(node, fn => {
        host.run(fn, 'validate');
        // a field required (nullTest="error") without a value
        const v = kid(fn.tpl, 'validate');
        if (fn.tpl.tag === 'field' && v?.a.nullTest === 'error' && (fn.val?.raw ?? '') === '') warn(`Validation failed: ${label(fn)} is required`);
      });
      walk(node, fn => host.run(fn, 'ready', { refs: ['$form'] }));
      walk(node, fn => host.run(fn, 'docReady', { refs: ['$host', '$'] }));
      walk(node, fn => host.run(fn, 'prePrint', { refs: ['$', '$host'] }));
    },
    // the JavaScript actions of a field in a fillable PDF (acrobat.js): fieldName( node ) is the PDF field of a
    // form node (null: printed only, its value is a constant)
    acrobat(fn, fieldName) {
      const EV = { calculate: 'calculate', validate: 'validate', change: 'keystroke', exit: 'blur', enter: 'focus', click: 'mouseUp', mouseUp: 'mouseUp' };
      const out = {};
      const constOf = n => JSON.stringify(n?.val ? rawOf(n) : null);
      const self = fieldName(fn);
      if (!self) return out;
      // a form node as JavaScript: a field proxy, or a subform with its children, instances and instance manager
      let budget = 400;
      const nodeJs = (n, depth = 0, noAll = false) => {
        if (!n?.tpl || --budget < 0) return 'null';
        const t = n.tpl.tag;
        if (t === 'field' || t === 'draw') { const nm = fieldName(n); return nm ? `$fld(doc, ${JSON.stringify(nm)}, ${constOf(n)})` : `$const(${constOf(n)})`; }
        if (depth > 3) return '{}';
        const kidsByName = new Map();
        for (const k of n.kids || []) { const nm = nameOf(k); if (nm && !kidsByName.has(nm)) kidsByName.set(nm, k); }
        const sibs = (n.parent?.kids || []).filter(k => k.orig === n.orig);
        const props = [...kidsByName].map(([nm, k]) => `${JSON.stringify(nm)}: ${nodeJs(k, depth + 1, noAll)}`);
        for (const [nm, k] of kidsByName) { const c = (n.kids || []).filter(x => x.orig === k.orig).length; props.push(`${JSON.stringify(`_${nm}`)}: { count: ${c} }`); }
        props.push(`instanceManager: { count: ${sibs.length} }`, `name: ${JSON.stringify(nameOf(n))}`, `index: ${Math.max(0, sibs.indexOf(n))}`);
        if (!noAll && depth < 3) props.push(`all: $list([${sibs.map(s => nodeJs(s, depth + 1, true)).join(', ')}])`);
        return `{ ${props.join(', ')} }`;
      };
      for (const s of scriptsOf(fn.tpl)) {
        const ev = EV[s.activity];
        if (!ev || (s.ref && s.ref !== '$')) continue;
        const src = deepText(s.script);
        const js = /javascript/i.test(s.script.a.contentType || '');
        const selfJs = ['calculate', 'validate', 'keystroke'].includes(ev) ? `$self(doc, ${JSON.stringify(self)}, ${constOf(fn)})` : `$fld(doc, ${JSON.stringify(self)}, ${constOf(fn)})`;
        let body;
        try {
          if (js) {
            // the names the script uses, resolved from this field now
            const names = [...new Set([...src.replace(/\/\/.*$|\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/gm, ' ').matchAll(/(^|[^.\w$])([A-Za-z_$][\w$]*)/g)].map(m => m[2]))]
              .filter(nm => !/^(this|var|if|else|for|while|return|function|new|true|false|null|undefined|typeof|in|of|do|break|continue|xfa|event|app|util|Math|Number|String|Date|Array|Object|JSON|parseInt|parseFloat|isNaN)$/.test(nm));
            const scope = [];
            for (const nm of names) {
              if (nm.startsWith('_') && nm.length > 1) { const c = scopeFind(fn, nm.slice(1))[0]; if (c?.tpl) { scope.push(`${JSON.stringify(nm)}: { count: ${(c.parent?.kids || []).filter(k => k.orig === c.orig).length} }`); continue; } }
              const c = scopeFind(fn, nm)[0];
              if (c?.tpl) scope.push(`${JSON.stringify(nm)}: ${c === fn ? '__this' : nodeJs(c)}`);
            }
            body = `var __this = ${selfJs}; var __s = { ${scope.join(', ')} }; return (function () { with (__s) { return eval(${JSON.stringify(src)}); } }).call(__this);`;
          } else {
            const ref = (p, { all, write } = {}) => {
              if (p === '$' || p === 'this') return write ? `__this.rawValue = ${write}` : '__this.rawValue';
              // the longest prefix that is a form node; the rest are properties of its proxy
              const segs = p.split('.');
              for (let k = segs.length; k > 0; k--) {
                const head = segs.slice(0, k).join('.'), rest = segs.slice(k);
                const nodes = head === '$' ? [fn] : resolve(head, fn, { all: !!all }).filter(x => x?.tpl);
                if (!nodes.length) continue;
                const exprOf = n => (n === fn ? '__this' : nodeJs(n));
                const prop = rest.length ? `.${rest.join('.')}` : '.rawValue';
                if (all && !write) return `$list([${nodes.map(n => `${exprOf(n)}${prop}`).join(', ')}])`;
                return write ? `${exprOf(nodes[0])}${prop} = ${write}` : `${exprOf(nodes[0])}${prop}`;
              }
              return write ? 'void 0' : 'null';
            };
            body = `var __this = ${selfJs}; return (function () {\n${formcalcToJs(src, ref)}\n})();`;
          }
        } catch (e) { warn(`Script of ${label(fn)} (${s.activity}) is not available in the fillable PDF: ${e.message}`); continue; }
        const tail = ev === 'calculate' ? 'if (__r !== undefined && (__r === null || typeof __r !== "object")) event.value = (__r === null ? "" : __r);'
          : ev === 'validate' ? `if (__r === false || __r === 0) { event.rc = false; app.alert(${JSON.stringify(deepText(kid(kid(fn.tpl, 'validate'), 'message')).trim() || `${nameOf(fn)}: the value is not valid`)}); }`
            : '';
        const code = `(function (doc) { var __r = (function () { ${body} })(); ${tail} })(this);`;
        out[ev] = out[ev] ? `${out[ev]}\n${code}` : code;
      }
      return out;
    },
    // a page area's content on one page: initialize, page-number calculations, layout:ready
    preparePage(node) {
      host.initialize(node);
      host.calculate(node);
      walk(node, fn => host.run(fn, 'ready', { refs: ['$layout'] }));
    },
  };
  return host;
}
