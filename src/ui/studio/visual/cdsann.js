// CDS annotations as data: parse `@UI: { lineItem: [ { position: 10 } ] }` / `@UI.hidden: true` into a flat map of
// paths ({ 'UI.lineItem': [ { position: 10 } ], 'UI.hidden': true }) and write them back in the compact SAP style.
// Values: strings, numbers, booleans, enums ({ $e: 'HIGH' } for #HIGH), arrays, objects.

// split a source fragment at top-level separators (outside strings and brackets)
export function splitTop(text, sep) {
  const out = [];
  let depth = 0, cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { cur += c; if (c === "'") q = false; continue; }
    if (c === "'") { q = true; cur += c; continue; }
    if ('{[('.includes(c)) depth++;
    if ('}])'.includes(c)) depth--;
    if (c === sep && depth === 0) { out.push(cur); cur = ''; continue; }
    cur += c;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

// a value: { a: 1, b: [ … ] } | [ … ] | 'text' | #ENUM | 123 | true / false
export function parseValue(src) {
  let i = 0;
  const s = String(src);
  const ws = () => { while (i < s.length && /\s/.test(s[i])) i++; };
  const val = () => {
    ws();
    const c = s[i];
    if (c === '{') {
      i++; const o = {};
      for (;;) {
        ws();
        if (s[i] === '}') { i++; return o; }
        const m = /^[\w.$]+/.exec(s.slice(i));
        if (!m) throw new Error(`annotation: name expected at "${s.slice(i, i + 20)}"`);
        i += m[0].length; ws();
        let v = true;
        if (s[i] === ':') { i++; v = val(); }
        setPath(o, m[0], v);
        ws();
        if (s[i] === ',') i++;
      }
    }
    if (c === '[') {
      i++; const a = [];
      for (;;) { ws(); if (s[i] === ']') { i++; return a; } a.push(val()); ws(); if (s[i] === ',') i++; }
    }
    if (c === "'") { let t = ''; i++; while (i < s.length && s[i] !== "'") t += s[i++]; i++; return t; }
    if (c === '#') { const m = /^#[\w.]+/.exec(s.slice(i)); i += m[0].length; return { $e: m[0].slice(1) }; }
    const m = /^-?\d+(\.\d+)?|^true|^false|^null/.exec(s.slice(i));
    if (m) { i += m[0].length; return m[0] === 'true' ? true : m[0] === 'false' ? false : m[0] === 'null' ? null : Number(m[0]); }
    throw new Error(`annotation: value expected at "${s.slice(i, i + 20)}"`);
  };
  const v = val();
  ws();
  if (i < s.length) throw new Error(`annotation: unexpected "${s.slice(i, i + 20)}"`);
  return v;
}
function setPath(o, p, v) {
  const parts = p.split('.');
  let cur = o;
  for (const k of parts.slice(0, -1)) { if (!cur[k] || typeof cur[k] !== 'object' || Array.isArray(cur[k]) || cur[k].$e) cur[k] = {}; cur = cur[k]; }
  cur[parts.at(-1)] = v;
}

export function formatValue(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return `[ ${v.map(formatValue).join(', ')} ]`;
  if (typeof v === 'object') {
    if (v.$e) return `#${v.$e}`;
    return `{ ${Object.entries(v).map(([k, x]) => `${k}: ${formatValue(x)}`).join(', ')} }`;
  }
  if (typeof v === 'string') return `'${v.replace(/'/g, "''")}'`;
  return String(v);
}

// leading annotations of a fragment: [{ path, value, raw }] and the rest
export function takeAnnotations(text) {
  const anns = [];
  let s = text;
  for (;;) {
    const lead = /^\s*/.exec(s)[0];
    const m = /^@([\w.]+)\s*(:)?\s*/.exec(s.slice(lead.length));
    if (!m) break;
    let i = lead.length + m[0].length;
    let raw;
    if (!m[2]) raw = '';
    else if (s[i] === '{' || s[i] === '[') {
      let depth = 0, q = false, j = i;
      for (; j < s.length; j++) {
        const c = s[j];
        if (q) { if (c === "'") q = false; continue; }
        if (c === "'") { q = true; continue; }
        if (c === '{' || c === '[') depth++;
        if (c === '}' || c === ']') { depth--; if (depth === 0) { j++; break; } }
      }
      raw = s.slice(i, j); i = j;
    } else {
      const nl = s.indexOf('\n', i);
      const end = nl < 0 ? s.length : nl;
      raw = s.slice(i, end).trim(); i = end;
    }
    let value;
    try { value = m[2] ? parseValue(raw) : true; } catch { value = { $raw: raw }; }
    anns.push({ path: m[1], value, raw });
    s = s.slice(i);
  }
  return { anns, rest: s };
}

// annotations -> flat map path -> value ('UI.lineItem', 'EndUserText.label'); `@UI: { a: …, b: … }` (a namespace
// written as one object) is split into its annotations
export function flatten(anns) {
  const map = {};
  for (const a of anns) {
    const v = a.value;
    if (!a.path.includes('.') && v && typeof v === 'object' && !Array.isArray(v) && !v.$e && !v.$raw) for (const [k, x] of Object.entries(v)) map[`${a.path}.${k}`] = x;
    else map[a.path] = v;
  }
  return map;
}

// flat map -> annotation lines; several UI.* entries become `@UI: { … }` (as written by hand)
export function toLines(map, ind = '') {
  const lines = [], ui = [];
  let at = -1;
  for (const [p, v] of Object.entries(map)) {
    if (v === undefined) continue;
    if (v && v.$raw !== undefined) { lines.push(`${ind}@${p}: ${v.$raw}`); continue; }
    if (p.startsWith('UI.')) { if (at < 0) { at = lines.length; lines.push(null); } ui.push([p.slice(3), v]); } else lines.push(`${ind}@${p}: ${formatValue(v)}`);
  }
  if (ui.length === 1) lines[at] = `${ind}@UI.${ui[0][0]}: ${formatValue(ui[0][1])}`;
  else if (ui.length) lines[at] = `${ind}@UI: { ${ui.map(([k, v]) => `${k}: ${formatValue(v)}`).join(`,\n${ind}       `)} }`;
  return lines;
}
