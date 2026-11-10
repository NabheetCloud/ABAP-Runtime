// The ABAP Dictionary objects of an app that are not CDS sources: domains (.doma.xml), data elements (.dtel.xml)
// and table types (.ttyp.xml) in the abapGit layout. They give
//   - types: a Z data element (or a structure component typed with one) becomes its built-in type on the RAP runtime
//     too (CHAR 10, CURR 15,2 …) instead of an unknown name
//   - checks at activation: invalid values (a letter in LENG, an unknown data type, decimals for CHAR, a fixed value
//     longer than the domain) and references to objects that do not exist (domain, line type, value table, include,
//     check table, reference field), reported with the line of the tag
// Structures (define structure) and their include structures are expanded here as well (expandIncludes).
import fs from 'node:fs';
import path from 'node:path';

// DDIC data types: [length: fixed value or [min, max]], decimals allowed, the CDS built-in type
export const DDIC_TYPES = {
  CHAR: { len: [1, 1333], cds: 'char', text: 'Character string' },
  NUMC: { len: [1, 255], cds: 'numc', text: 'Numeric text (digits only)' },
  DEC: { len: [1, 31], dec: true, cds: 'dec', text: 'Packed number' },
  CURR: { len: [1, 31], dec: true, cds: 'curr', text: 'Amount (needs a currency key field)' },
  QUAN: { len: [1, 31], dec: true, cds: 'quan', text: 'Quantity (needs a unit field)' },
  CUKY: { len: 5, cds: 'cuky', text: 'Currency key' },
  UNIT: { len: [2, 3], cds: 'unit', text: 'Unit of measure' },
  DATS: { len: 8, cds: 'dats', text: 'Date (YYYYMMDD)' },
  TIMS: { len: 6, cds: 'tims', text: 'Time (HHMMSS)' },
  DATN: { len: 8, cds: 'datn', text: 'Date (database date)' },
  TIMN: { len: 6, cds: 'timn', text: 'Time (database time)' },
  UTCL: { len: 27, cds: 'utclong', text: 'UTC time stamp' },
  INT1: { len: 3, cds: 'int1', text: '1-byte integer (0…255)' },
  INT2: { len: 5, cds: 'int2', text: '2-byte integer' },
  INT4: { len: 10, cds: 'int4', text: '4-byte integer' },
  INT8: { len: 19, cds: 'int8', text: '8-byte integer' },
  FLTP: { len: 16, dec: true, cds: 'fltp', text: 'Floating point number' },
  D16N: { len: 16, cds: 'd16n', text: 'Decimal floating point (16)' },
  D34N: { len: 34, cds: 'd34n', text: 'Decimal floating point (34)' },
  STRG: { len: 0, cds: 'string', text: 'String (variable length)' },
  SSTR: { len: [1, 1333], cds: 'sstring', text: 'Short string' },
  RSTR: { len: 0, cds: 'rawstring', text: 'Byte string' },
  RAW: { len: [1, 32000], cds: 'raw', text: 'Bytes' },
  LANG: { len: 1, cds: 'lang', text: 'Language key' },
  CLNT: { len: 3, cds: 'clnt', text: 'Client' },
  ACCP: { len: 6, cds: 'accp', text: 'Posting period (YYYYMM)' },
  PREC: { len: 2, cds: 'prec', text: 'Precision' },
};
// the names abapGit / older systems also write
const ALIASES = { STRING: 'STRG', SSTRING: 'SSTR', RAWSTRING: 'RSTR', UTCLONG: 'UTCL', INT: 'INT4' };
export const ddicType = t => { const u = String(t || '').toUpperCase(); return ALIASES[u] || u; };

const isCustomer = n => /^[ZY]/i.test(String(n || '')) || /^\/[^/]+\//.test(String(n || ''));

// the value of a tag and its line in the source
function tagAt(xml, tag, from = 0) {
  const re = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'g');
  re.lastIndex = from;
  const m = re.exec(xml);
  if (!m) return null;
  return { value: m[1].trim().replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&'), line: xml.slice(0, m.index).split('\n').length, index: m.index };
}
const val = (xml, tag) => tagAt(xml, tag)?.value ?? '';
const num = v => (v === '' || v == null ? null : /^\d+$/.test(String(v).trim()) ? Number(v) : NaN);

export function parseDoma(xml) {
  const fixed = [];
  for (const m of xml.matchAll(/<DD07V>([\s\S]*?)<\/DD07V>/g)) {
    const at = xml.slice(0, m.index).split('\n').length;
    fixed.push({ low: val(m[1], 'DOMVALUE_L'), high: val(m[1], 'DOMVALUE_H'), text: val(m[1], 'DDTEXT'), line: at });
  }
  return { kind: 'doma', name: val(xml, 'DOMNAME').toLowerCase(), datatype: ddicType(val(xml, 'DATATYPE')), leng: val(xml, 'LENG'), decimals: val(xml, 'DECIMALS'), outputlen: val(xml, 'OUTPUTLEN'),
    lowercase: val(xml, 'LOWERCASE') === 'X', sign: val(xml, 'SIGNFLAG') === 'X', valueTable: val(xml, 'ENTITYTAB').toLowerCase(), text: val(xml, 'DDTEXT'), fixed };
}
export function parseDtel(xml) {
  return { kind: 'dtel', name: val(xml, 'ROLLNAME').toLowerCase(), domain: val(xml, 'DOMNAME').toLowerCase(), refkind: val(xml, 'REFKIND'), datatype: ddicType(val(xml, 'DATATYPE')), leng: val(xml, 'LENG'), decimals: val(xml, 'DECIMALS'),
    text: val(xml, 'DDTEXT'), labels: { short: val(xml, 'SCRTEXT_S'), medium: val(xml, 'SCRTEXT_M'), long: val(xml, 'SCRTEXT_L'), heading: val(xml, 'REPTEXT') } };
}
export function parseTtyp(xml) {
  return { kind: 'ttyp', name: val(xml, 'TYPENAME').toLowerCase(), rowtype: val(xml, 'ROWTYPE').toLowerCase(), rowkind: val(xml, 'ROWKIND'), datatype: ddicType(val(xml, 'DATATYPE')), leng: val(xml, 'LENG'), decimals: val(xml, 'DECIMALS'), access: val(xml, 'ACCESSMODE'), text: val(xml, 'DDTEXT') };
}

// the DDIC XML objects of a folder of sources (an app's src, recursively)
export function readDdic(files) {
  const cat = { domains: new Map(), dataElements: new Map(), tableTypes: new Map(), files: new Map() };
  for (const f of files) {
    const b = path.basename(f).toLowerCase();
    const kind = /\.doma\.xml$/.test(b) ? 'doma' : /\.dtel\.xml$/.test(b) ? 'dtel' : /\.ttyp\.xml$/.test(b) ? 'ttyp' : null;
    if (!kind) continue;
    let xml;
    try { xml = fs.readFileSync(f, 'utf8'); } catch { continue; }
    const o = kind === 'doma' ? parseDoma(xml) : kind === 'dtel' ? parseDtel(xml) : parseTtyp(xml);
    o.name ||= b.split('.')[0];
    o.file = f; o.xml = xml;
    (kind === 'doma' ? cat.domains : kind === 'dtel' ? cat.dataElements : cat.tableTypes).set(o.name, o);
  }
  return cat;
}

// a data element / domain -> the CDS built-in type ({ name: 'abap.curr', len: 15, dec: 2 }), null when unknown
export function builtinOf(name, cat, seen = new Set()) {
  const n = String(name || '').toLowerCase();
  if (!cat || seen.has(n)) return null;
  seen.add(n);
  const de = cat.dataElements.get(n);
  const fromSpec = (dt, leng, dec) => {
    const t = DDIC_TYPES[ddicType(dt)];
    if (!t) return null;
    const len = Array.isArray(t.len) ? (Number(leng) || t.len[0]) : undefined;
    return { name: `abap.${t.cds}`, ...(len !== undefined && t.cds !== 'unit' ? { len } : t.cds === 'unit' ? { len: Number(leng) || 3 } : {}), ...(t.dec && Number(dec) ? { dec: Number(dec) } : t.dec && /dec|curr|quan/.test(t.cds) ? { dec: 0 } : {}) };
  };
  if (de) {
    if (de.domain) { const d = cat.domains.get(de.domain); return d ? fromSpec(d.datatype, d.leng, d.decimals) : null; }
    return fromSpec(de.datatype, de.leng, de.decimals);
  }
  const d = cat.domains.get(n);
  return d ? fromSpec(d.datatype, d.leng, d.decimals) : null;
}

// the include structures of a table or structure, expanded (recursively, with the suffix) from the other
// definitions: lookup(name) -> a def with fields, or null
export function expandIncludes(def, lookup, onMissing = () => {}, stack = []) {
  if (!def.fields.some(f => f.include)) return def.fields;
  const out = [];
  for (const f of def.fields) {
    if (!f.include) { out.push(f); continue; }
    if (stack.includes(f.include)) { onMissing(f, `include ${f.include} includes itself`); continue; }
    const inc = lookup(f.include);
    if (!inc) { onMissing(f, `Include structure ${f.include.toUpperCase()} does not exist`); continue; }
    for (const c of expandIncludes(inc, lookup, onMissing, [...stack, def.name])) {
      if (c.include) continue;
      const name = f.suffix ? `${c.name}${String(f.suffix).toLowerCase()}` : c.name;
      out.push({ ...c, name, label: f.suffix ? `${c.label || c.name}${f.suffix}` : c.label, key: false, fromInclude: f.include });
    }
  }
  return out;
}

// ---------------------------------------------------------------- checks at activation
// known: name -> true for the objects the app can refer to (tables, structures, views, data elements, table types,
// the system's objects); err(file, line, message) / warn(...)
export function checkDdic(cat, { known = () => false, err, warn }) {
  const exists = n => !!n && (cat.dataElements.has(n) || cat.domains.has(n) || cat.tableTypes.has(n) || known(n));
  const line = (o, tag) => tagAt(o.xml, tag)?.line ?? null;
  // data type, length and decimals of a domain or a data element with a built-in type
  const checkType = (o, what) => {
    const dt = o.datatype;
    const t = DDIC_TYPES[dt];
    if (!dt) { err(o.file, line(o, 'DOMNAME') || line(o, 'ROLLNAME'), `${what} ${o.name.toUpperCase()}: no data type (DATATYPE)`); return; }
    if (!t) { err(o.file, line(o, 'DATATYPE'), `${what} ${o.name.toUpperCase()}: unknown data type ${dt} (use ${Object.keys(DDIC_TYPES).slice(0, 12).join(', ')}, …)`); return; }
    const len = num(o.leng), dec = num(o.decimals);
    if (Number.isNaN(len)) { err(o.file, line(o, 'LENG'), `${what} ${o.name.toUpperCase()}: the length "${o.leng}" is not a number`); return; }
    if (Number.isNaN(dec)) { err(o.file, line(o, 'DECIMALS'), `${what} ${o.name.toUpperCase()}: the decimals "${o.decimals}" are not a number`); return; }
    if (Array.isArray(t.len)) {
      if (!len) err(o.file, line(o, 'LENG') || line(o, 'DATATYPE'), `${what} ${o.name.toUpperCase()}: ${dt} needs a length (${t.len[0]}…${t.len[1]})`);
      else if (len < t.len[0] || len > t.len[1]) err(o.file, line(o, 'LENG'), `${what} ${o.name.toUpperCase()}: length ${len} is out of range for ${dt} (${t.len[0]}…${t.len[1]})`);
    } else if (len && t.len && len !== t.len) warn(o.file, line(o, 'LENG'), `${what} ${o.name.toUpperCase()}: ${dt} has the fixed length ${t.len} (${len} is ignored)`);
    if (dec) {
      if (!t.dec) err(o.file, line(o, 'DECIMALS'), `${what} ${o.name.toUpperCase()}: ${dt} has no decimals`);
      else if (len && dec > len && dt !== 'FLTP') err(o.file, line(o, 'DECIMALS'), `${what} ${o.name.toUpperCase()}: ${dec} decimals do not fit into length ${len}`);
      else if (dec > 14 && dt !== 'FLTP') err(o.file, line(o, 'DECIMALS'), `${what} ${o.name.toUpperCase()}: at most 14 decimals`);
    }
    return len;
  };
  for (const d of cat.domains.values()) {
    const len = checkType(d, 'Domain');
    for (const v of d.fixed) {
      if (len && v.low.length > len) err(d.file, v.line, `Domain ${d.name.toUpperCase()}: fixed value "${v.low}" is longer than ${len}`);
      if (d.datatype === 'NUMC' && !/^\d*$/.test(v.low)) err(d.file, v.line, `Domain ${d.name.toUpperCase()}: fixed value "${v.low}" is not numeric (NUMC)`);
      if (!d.lowercase && /[a-z]/.test(v.low) && /CHAR|SSTR/.test(d.datatype)) warn(d.file, v.line, `Domain ${d.name.toUpperCase()}: fixed value "${v.low}" has lower case letters but the domain is not "lower case"`);
    }
    const seen = new Set();
    for (const v of d.fixed) { if (seen.has(v.low)) err(d.file, v.line, `Domain ${d.name.toUpperCase()}: fixed value "${v.low}" twice`); seen.add(v.low); }
    if (d.valueTable && isCustomer(d.valueTable) && !exists(d.valueTable)) err(d.file, line(d, 'ENTITYTAB'), `Domain ${d.name.toUpperCase()}: value table ${d.valueTable.toUpperCase()} does not exist`);
  }
  for (const e of cat.dataElements.values()) {
    if (e.domain) {
      if (!cat.domains.has(e.domain) && (isCustomer(e.domain) || !known(e.domain))) {
        const msg = `Data element ${e.name.toUpperCase()}: domain ${e.domain.toUpperCase()} does not exist`;
        if (isCustomer(e.domain)) err(e.file, line(e, 'DOMNAME'), msg); else warn(e.file, line(e, 'DOMNAME'), `${msg} in this app (a standard domain is assumed)`);
      }
    } else if (e.refkind !== 'R') checkType(e, 'Data element');
    const lim = { short: 10, medium: 20, long: 40, heading: 55 };
    for (const [k, max] of Object.entries(lim)) if ((e.labels[k] || '').length > max) warn(e.file, line(e, { short: 'SCRTEXT_S', medium: 'SCRTEXT_M', long: 'SCRTEXT_L', heading: 'REPTEXT' }[k]), `Data element ${e.name.toUpperCase()}: the ${k} label is longer than ${max} characters`);
  }
  for (const t of cat.tableTypes.values()) {
    if (t.rowkind === '' && t.datatype) { checkType(t, 'Table type'); continue; }
    if (!t.rowtype) { err(t.file, line(t, 'TYPENAME'), `Table type ${t.name.toUpperCase()}: no line type (ROWTYPE)`); continue; }
    if (isCustomer(t.rowtype) && !exists(t.rowtype)) err(t.file, line(t, 'ROWTYPE'), `Table type ${t.name.toUpperCase()}: line type ${t.rowtype.toUpperCase()} does not exist`);
  }
}

// lock objects: the tables they lock must exist
export function checkEnqu(file, xml, { known, err }) {
  for (const tag of ['ROOTTAB', 'TABNAME']) {
    let at = 0, m;
    while ((m = tagAt(xml, tag, at))) {
      at = m.index + 1;
      const n = m.value.toLowerCase();
      if (n && isCustomer(n) && !known(n)) err(file, m.line, `Lock object: table ${m.value} does not exist`);
    }
  }
}

// the data elements of other apps of the system (by name): a .dtel.xml in a sibling app's src
export function systemDdicFiles(systemDir, ownDir) {
  const out = [];
  if (!systemDir || !fs.existsSync(systemDir)) return out;
  for (const app of fs.readdirSync(systemDir, { withFileTypes: true })) {
    if (!app.isDirectory() || app.name.startsWith('.')) continue;
    const src = path.join(systemDir, app.name, 'src');
    if (path.resolve(systemDir, app.name) === path.resolve(ownDir) || !fs.existsSync(src)) continue;
    for (const f of fs.readdirSync(src)) if (/\.(doma|dtel|ttyp)\.xml$/i.test(f)) out.push(path.join(src, f));
  }
  return out;
}
