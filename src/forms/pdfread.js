// Reads the values of the fillable fields of a PDF (an interactive form filled in Adobe Reader, a browser or any PDF
// viewer and sent back): { "field name": value }. Handles incremental updates (the last version of an object wins),
// compressed object streams, field hierarchies (parent.child names), text in PDFDocEncoding and UTF-16, check boxes
// ('X' when checked) and choice lists, encrypted PDFs (AES-256: with the password, or none when only permissions are set).
import zlib from 'node:zlib';
import { fileKey, decrypt } from './crypt.js';

function unescapeLiteral(s) {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c !== '\\') { out += c; continue; }
    const n = s[++i];
    if (n === 'n') out += '\n'; else if (n === 'r') out += '\r'; else if (n === 't') out += '\t'; else if (n === 'b') out += '\b'; else if (n === 'f') out += '\f';
    else if (/[0-7]/.test(n)) { let o = n; while (o.length < 3 && /[0-7]/.test(s[i + 1])) o += s[++i]; out += String.fromCharCode(parseInt(o, 8) & 0xff); }
    else if (n === '\r') { if (s[i + 1] === '\n') i++; }
    else if (n === '\n') { /* line continuation */ }
    else out += n;
  }
  return out;
}
const decodeText = bin => {
  if (bin.charCodeAt(0) === 0xfe && bin.charCodeAt(1) === 0xff) return Buffer.from(bin.slice(2), 'latin1').swap16().toString('utf16le');
  if (bin.startsWith('\xef\xbb\xbf')) return Buffer.from(bin.slice(3), 'latin1').toString('utf8');
  return bin;
};

// a tiny parser of PDF objects (dictionaries, arrays, strings, names, numbers, references)
function parseValue(s, p = 0, dec = null) {
  const str = raw => { if (dec) raw = dec(Buffer.from(raw, 'latin1')).toString('latin1'); return { str: decodeText(raw), raw }; };
  const ws = () => { while (p < s.length) { if (/\s/.test(s[p])) p++; else if (s[p] === '%') { while (p < s.length && s[p] !== '\n' && s[p] !== '\r') p++; } else break; } };
  const value = () => {
    ws();
    const c = s[p];
    if (c === '<' && s[p + 1] === '<') {
      p += 2; const d = {};
      for (;;) { ws(); if (s[p] === '>' && s[p + 1] === '>') { p += 2; return d; } if (s[p] !== '/') throw new Error(`PDF: name expected at ${p}`); const k = name(); d[k] = value(); }
    }
    if (c === '[') { p++; const a = []; for (;;) { ws(); if (s[p] === ']') { p++; return a; } a.push(value()); } }
    if (c === '(') {
      let depth = 1, q = ++p;
      while (p < s.length && depth) { if (s[p] === '\\') p += 2; else { if (s[p] === '(') depth++; else if (s[p] === ')') depth--; p++; } }
      return str(unescapeLiteral(s.slice(q, p - 1)));
    }
    if (c === '<') { const q = ++p; while (s[p] !== '>') p++; const hex = s.slice(q, p++).replace(/\s/g, ''); return str(Buffer.from(hex.length % 2 ? `${hex}0` : hex, 'hex').toString('latin1')); }
    if (c === '/') return { name: name() };
    const m = /^(-?\d*\.?\d+)(?:\s+(\d+)\s+R(?![A-Za-z]))?/.exec(s.slice(p, p + 40));
    if (m) { p += m[0].length; return m[2] !== undefined ? { ref: Number(m[1]) } : Number(m[1]); }
    const w = /^(true|false|null)/.exec(s.slice(p, p + 5));
    if (w) { p += w[0].length; return w[0] === 'null' ? null : w[0] === 'true'; }
    throw new Error(`PDF: cannot read at ${p}: ${s.slice(p, p + 20)}`);
  };
  const name = () => { const q = ++p; while (p < s.length && !/[\s/<>[\]()%{}]/.test(s[p])) p++; return s.slice(q, p).replace(/#([0-9a-f]{2})/gi, (x, h) => String.fromCharCode(parseInt(h, 16))); };
  const v = value();
  return { v, end: p };
}

export function readObjects(pdf, { password } = {}) {
  const s = Buffer.from(pdf).toString('latin1');
  // encrypted: the file key from the password (or the empty document password), then strings and streams decrypted
  let key = null, encId = null;
  const enc = /\/Encrypt\s+(\d+)\s+0\s+R/.exec(s.slice(s.lastIndexOf('trailer')));
  if (enc) {
    encId = Number(enc[1]);
    const at = new RegExp(`(?:^|\\s)${encId}\\s+0\\s+obj\\b`).exec(s);
    const d = at && parseValue(s, at.index + at[0].length).v;
    if (!d || d.V !== 5) throw new Error('The PDF is encrypted with a method other than AES-256');
    const b = x => Buffer.from(x.raw, 'latin1');
    key = fileKey({ O: b(d.O), U: b(d.U), OE: b(d.OE), UE: b(d.UE) }, password ?? '');
    if (!key) throw new Error('The PDF is protected by a password');
  }
  const dec = key ? data => (data.length >= 32 ? decrypt(key, data) : data) : null;
  const objs = new Map();
  const re = /(\d+)\s+(\d+)\s+obj\b/g;
  let m;
  while ((m = re.exec(s))) {
    try {
      const own = Number(m[1]) === encId ? null : dec;
      const { v, end } = parseValue(s, m.index + m[0].length, own);
      let obj = v;
      const after = s.slice(end, end + 12);
      if (/^\s*stream\r?\n/.test(after) && v && typeof v === 'object') {
        const start = end + /^\s*stream\r?\n/.exec(after)[0].length;
        const length = typeof v.Length === 'number' ? v.Length : s.indexOf('endstream', start) - start;
        let data = Buffer.from(s.slice(start, start + length), 'latin1');
        if (own) { try { data = own(data); } catch { data = Buffer.alloc(0); } }
        if (v.Filter?.name === 'FlateDecode') { try { data = zlib.inflateSync(data); } catch { data = Buffer.alloc(0); } }
        obj = { dict: v, data };
        re.lastIndex = start + length;
      } else re.lastIndex = end;
      objs.set(Number(m[1]), obj);
    } catch { /* not an object (inside a stream) */ }
  }
  // compressed object streams
  for (const [, o] of [...objs]) {
    if (!o?.dict || o.dict.Type?.name !== 'ObjStm') continue;
    const text = o.data.toString('latin1'), n = o.dict.N, first = o.dict.First;
    const head = text.slice(0, first).trim().split(/\s+/).map(Number);
    for (let k = 0; k < n; k++) {
      try { objs.set(head[2 * k], parseValue(text, first + head[2 * k + 1]).v); } catch {}
    }
  }
  return objs;
}

export function readFields(pdf, opts) {
  const objs = readObjects(pdf, opts);
  const deref = v => (v && typeof v === 'object' && 'ref' in v ? objs.get(v.ref) : v);
  const out = {};
  const seen = new Set();
  const visit = (ref, prefix) => {
    const d = deref(ref);
    if (!d || typeof d !== 'object' || seen.has(d)) return;
    seen.add(d);
    const part = d.T?.str;
    const full = part === undefined ? prefix : prefix ? `${prefix}.${part}` : part;
    const kids = deref(d.Kids);
    if (Array.isArray(kids) && kids.some(k => deref(k)?.T)) { for (const k of kids) visit(k, full); return; }
    let ft = d.FT?.name, v = deref(d.V);
    for (let p = deref(d.Parent); !ft && p; p = deref(p.Parent)) ft = p.FT?.name;
    if (!full) return;
    if (ft === 'Btn') v = v?.name && v.name !== 'Off' ? 'X' : '';
    else if (ft === 'Sig') v = v ? 'signed' : '';
    else if (Array.isArray(v)) v = v.map(x => x?.str ?? '').join('\n');
    else v = v?.str ?? (v?.name || '');
    out[full] = v;
  };
  // the fields of the AcroForm (the catalog: the last one written)
  const catalogs = [...objs.values()].filter(o => o?.Type?.name === 'Catalog');
  const acro = deref(catalogs.at(-1)?.AcroForm);
  for (const f of deref(acro?.Fields) || []) visit(f, '');
  return out;
}

// field values -> nested data ("header.remark" -> { header: { remark } })
export function nest(values) {
  const out = {};
  for (const [k, v] of Object.entries(values)) {
    const parts = k.split('.');
    let cur = out;
    for (const p of parts.slice(0, -1)) cur = cur[p] = typeof cur[p] === 'object' ? cur[p] : {};
    cur[parts.at(-1)] = v;
  }
  return out;
}
