// The output queue (spool) shared by the RAP runtime and the classic engine: the table rap_output, merging the PDFs
// of one form processing job (FP_JOB_OPEN … FP_JOB_CLOSE) into one output request, and the print data in a printer
// language (PDL) for a print queue:
// - PDF  (default) the rendered PDF itself
// - PS   PostScript level 2: converted with pdftops (poppler) or Ghostscript when one is installed; otherwise the
//        PDF is kept and a warning returned
// - ZPL  label printers (Zebra): the text of every page at its position (^FO x,y ^A0 ^FD text ^FS), 203 dpi;
//        graphics, images and barcodes are not converted
// The format comes from is_options-pdl (render_4_pq) or the print queue's definition (table rap_print_queue:
// qname, format), else PDF.
import zlib from 'node:zlib';
import { spawnSync } from 'node:child_process';

// ---------------------------------------------------------------- the table
const COLUMNS = [['qname', 'TEXT'], ['copies', 'INTEGER'], ['format', 'TEXT'], ['pdl', 'BLOB'], ['options', 'TEXT']];
export function ensureOutputTable(db) {
  const pg = db.kind === 'postgres';
  db.exec(`CREATE TABLE IF NOT EXISTS rap_output (id INTEGER PRIMARY KEY${pg ? '' : ' AUTOINCREMENT'}, form TEXT, title TEXT, username TEXT, created BIGINT, pages INTEGER, pdf ${pg ? 'BYTEA' : 'BLOB'})`);
  for (const [c, t] of COLUMNS) {
    const type = pg && t === 'BLOB' ? 'BYTEA' : t;
    if (pg) { db.exec(`ALTER TABLE rap_output ADD COLUMN IF NOT EXISTS ${c} ${type}`); continue; }
    try { db.exec(`ALTER TABLE rap_output ADD COLUMN ${c} ${type}`); } catch { /* exists */ }
  }
  db.exec('CREATE TABLE IF NOT EXISTS rap_print_queue (qname TEXT PRIMARY KEY, format TEXT, description TEXT)');
}
// one output request; returns its number
export function insertOutput(db, { form, title, username, pages, pdf, qname = 'DEFAULT', copies = 1, format = 'PDF', pdl = null, options = null }) {
  ensureOutputTable(db);
  const id = Number(db.prepare('SELECT COALESCE(MAX(id), 0) + 1 AS n FROM rap_output').get().n);
  db.prepare('INSERT INTO rap_output (id, form, title, username, created, pages, pdf, qname, copies, format, pdl, options) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, String(form || '').toUpperCase(), title, username || 'DEVELOPER', Date.now(), pages || 0, pdf || null, String(qname || 'DEFAULT').toUpperCase(), Number(copies) || 1, format || 'PDF', pdl, options ? JSON.stringify(options) : null);
  return id;
}
// the printer language of a print queue (rap_print_queue), else null
export function queueFormat(db, qname) {
  try { ensureOutputTable(db); return db.prepare('SELECT format FROM rap_print_queue WHERE qname = ?').get(String(qname || '').toUpperCase())?.format || null; } catch { return null; }
}
export const pageCount = pdf => (Buffer.from(pdf).toString('latin1').match(/\/Type\s*\/Page\b/g) || []).length;
// the language of print data by its first bytes
export function detectFormat(buf) {
  const head = Buffer.from(buf).subarray(0, 16).toString('latin1');
  return /^%PDF/.test(head) ? 'PDF' : /^%!/.test(head) ? 'PS' : /^\s*\^XA/.test(head) ? 'ZPL' : 'BIN';
}

// ---------------------------------------------------------------- PDF objects
const WS = /[\0\t\n\f\r ]/;
function readObjects(buf) {
  const s = buf.toString('latin1');
  if (/\/Encrypt\s+\d+\s+\d+\s+R/.test(s)) throw new Error('encrypted PDFs cannot be merged');
  const objs = new Map();
  const re = /(\d+)\s+(\d+)\s+obj\b/g;
  let m;
  while ((m = re.exec(s))) {
    const num = Number(m[1]);
    let i = re.lastIndex;
    while (WS.test(s[i])) i++;
    // the object: a dictionary (maybe with a stream) or any other value up to endobj
    let dict = null, stream = null, body;
    if (s.startsWith('<<', i)) {
      const end = dictEnd(s, i);
      dict = s.slice(i, end);
      let j = end;
      while (WS.test(s[j])) j++;
      if (s.startsWith('stream', j)) {
        j += 6;
        if (s[j] === '\r') j++;
        if (s[j] === '\n') j++;
        let len = /\/Length\s+(\d+)(?!\s+\d+\s+R)/.exec(dict)?.[1];
        const ref = /\/Length\s+(\d+)\s+\d+\s+R/.exec(dict);
        if (ref) { const lm = new RegExp(`(?:^|[^\\d])${ref[1]}\\s+0\\s+obj\\s+(\\d+)`).exec(s); len = lm?.[1]; }
        let n = len !== undefined ? Number(len) : -1;
        if (n < 0 || !/^\s*endstream/.test(s.slice(j + n, j + n + 20))) n = s.indexOf('endstream', j) - j;   // a wrong /Length: the end marker
        stream = buf.subarray(j, j + n);
        j = s.indexOf('endstream', j + n) + 9;
      }
      const eo = s.indexOf('endobj', j);
      re.lastIndex = eo < 0 ? j : eo + 6;
    } else {
      const eo = s.indexOf('endobj', i);
      body = s.slice(i, eo < 0 ? undefined : eo).trim();
      re.lastIndex = eo < 0 ? s.length : eo + 6;
    }
    if (dict && /\/Type\s*\/ObjStm\b/.test(dict)) throw new Error('PDFs with object streams cannot be merged');
    objs.set(num, { dict, stream, body });   // the last definition wins (incremental updates)
  }
  const trailer = [...s.matchAll(/trailer\s*(<<)/g)].pop();
  let root = trailer ? /\/Root\s+(\d+)\s+\d+\s+R/.exec(s.slice(trailer.index, dictEnd(s, trailer.index + trailer[0].length - 2)))?.[1] : null;
  if (!root) root = [...objs].find(([, o]) => o.dict && /\/Type\s*\/Catalog\b/.test(o.dict))?.[0];
  if (!root) throw new Error('no document catalog');
  return { objs, root: Number(root) };
}
function dictEnd(s, i) {
  let depth = 0;
  for (let j = i; j < s.length; j++) {
    const c = s[j];
    if (c === '(') { let d = 1; j++; for (; j < s.length && d; j++) { if (s[j] === '\\') { j++; continue; } if (s[j] === '(') d++; else if (s[j] === ')') d--; } j--; continue; }
    if (c === '%') { while (j < s.length && s[j] !== '\n' && s[j] !== '\r') j++; continue; }
    if (c === '<' && s[j + 1] === '<') { depth++; j++; continue; }
    if (c === '>' && s[j + 1] === '>') { depth--; j++; if (!depth) return j + 1; continue; }
  }
  return s.length;
}
const refOf = (dict, key) => { const m = new RegExp(`/${key}\\s+(\\d+)\\s+\\d+\\s+R`).exec(dict || ''); return m ? Number(m[1]) : null; };
const arrayRefs = (dict, key) => { const m = new RegExp(`/${key}\\s*\\[([^\\]]*)\\]`).exec(dict || ''); return m ? [...m[1].matchAll(/(\d+)\s+\d+\s+R/g)].map(x => Number(x[1])) : []; };
// a value of a dictionary (inheritable page attributes): /Key <value up to the next key>
function rawValue(dict, key) {
  const m = new RegExp(`/${key}(?=[\\s/<\\[(])`).exec(dict || '');
  if (!m) return null;
  let i = m.index + m[0].length;
  while (WS.test(dict[i])) i++;
  if (dict.startsWith('<<', i)) return dict.slice(i, dictEnd(dict, i));
  if (dict[i] === '[') { let d = 0, j = i; for (; j < dict.length; j++) { if (dict[j] === '[') d++; if (dict[j] === ']' && !--d) break; } return dict.slice(i, j + 1); }
  if (dict[i] === '(') { let d = 0, j = i; for (; j < dict.length; j++) { if (dict[j] === '\\') { j++; continue; } if (dict[j] === '(') d++; if (dict[j] === ')' && !--d) break; } return dict.slice(i, j + 1); }
  if (dict[i] === '<') return dict.slice(i, dict.indexOf('>', i) + 1);
  const r = /^(\d+\s+\d+\s+R|[^\s/>\]]+)/.exec(dict.slice(i));
  return r ? r[1] : null;
}
// the pages of a document in order, with their inherited attributes
function pagesOf(doc) {
  const out = [];
  const cat = doc.objs.get(doc.root)?.dict;
  const walk = (num, inherited, seen = new Set()) => {
    if (seen.has(num)) return;
    seen.add(num);
    const o = doc.objs.get(num);
    if (!o?.dict) return;
    if (/\/Type\s*\/Page\b/.test(o.dict)) { out.push({ num, inherited }); return; }
    const inh = { ...inherited };
    for (const k of ['Resources', 'MediaBox', 'CropBox', 'Rotate']) { const v = rawValue(o.dict, k); if (v) inh[k] = v; }
    for (const kid of arrayRefs(o.dict, 'Kids')) walk(kid, inh, seen);
  };
  walk(refOf(cat, 'Pages'), {});
  return out;
}

// merge PDFs: the pages of all of them, in order, in one document (fillable fields kept)
export function mergePdfs(buffers) {
  const list = buffers.map(b => Buffer.from(b));
  if (list.length === 1) return list[0];
  const out = [];   // [dict-or-body, stream]
  const pageRefs = [], fieldRefs = [];
  let acroExtra = '';
  const pagesId = 1, catalogId = 2;
  let next = 3;
  for (const buf of list) {
    const doc = readObjects(buf);
    const pages = pagesOf(doc);
    const map = new Map();
    for (const num of doc.objs.keys()) map.set(num, next++);
    const renum = t => t.replace(/(\d+)\s+(\d+)\s+R\b/g, (all, n) => (map.has(Number(n)) ? `${map.get(Number(n))} 0 R` : 'null'));
    const pageNums = new Set(pages.map(p => p.num));
    for (const [num, o] of doc.objs) {
      let d = o.dict;
      if (d && pageNums.has(num)) {
        const inh = pages.find(p => p.num === num).inherited;
        for (const [k, v] of Object.entries(inh)) if (!rawValue(d, k)) d = d.replace(/>>\s*$/, ` /${k} ${v} >>`);
        d = d.replace(/\/Parent\s+\d+\s+\d+\s+R/, '/Parent PARENT_REF');
      }
      out[map.get(num)] = d !== null ? [renum(d).replace('/Parent PARENT_REF', `/Parent ${pagesId} 0 R`), o.stream] : [renum(o.body ?? 'null'), null];
    }
    for (const p of pages) pageRefs.push(map.get(p.num));
    const cat = doc.objs.get(doc.root).dict;
    const acro = rawValue(cat, 'AcroForm');
    if (acro) {
      const ad = /^\d+\s+\d+\s+R$/.test(acro) ? doc.objs.get(Number(acro.split(/\s+/)[0]))?.dict || '' : acro;
      for (const f of arrayRefs(ad, 'Fields')) fieldRefs.push(map.get(f));
      if (!acroExtra) { const dr = rawValue(ad, 'DR'), da = rawValue(ad, 'DA'); acroExtra = renum(`${dr ? ` /DR ${dr}` : ''}${da ? ` /DA ${da}` : ''}`); }
    }
  }
  out[pagesId] = [`<< /Type /Pages /Kids [${pageRefs.map(n => `${n} 0 R`).join(' ')}] /Count ${pageRefs.length} >>`, null];
  out[catalogId] = [`<< /Type /Catalog /Pages ${pagesId} 0 R${fieldRefs.length ? ` /AcroForm << /Fields [${fieldRefs.map(n => `${n} 0 R`).join(' ')}]${acroExtra} >>` : ''} >>`, null];
  const parts = [Buffer.from('%PDF-1.7\n%\xe2\xe3\xcf\xd3\n', 'latin1')];
  let size = parts[0].length;
  const offsets = [];
  for (let n = 1; n < out.length; n++) {
    const o = out[n] || ['null', null];
    offsets[n] = size;
    let head = o[0];
    if (o[1]) head = head.replace(/\/Length\s+\d+(\s+\d+\s+R)?/, `/Length ${o[1].length}`);
    const chunk = o[1] ? Buffer.concat([Buffer.from(`${n} 0 obj\n${head}\nstream\n`, 'latin1'), o[1], Buffer.from('\nendstream\nendobj\n', 'latin1')]) : Buffer.from(`${n} 0 obj\n${head}\nendobj\n`, 'latin1');
    parts.push(chunk); size += chunk.length;
  }
  const xref = `xref\n0 ${out.length}\n0000000000 65535 f \n${offsets.slice(1).map(o => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${out.length} /Root ${catalogId} 0 R >>\nstartxref\n${size}\n%%EOF\n`;
  parts.push(Buffer.from(xref, 'latin1'));
  return Buffer.concat(parts);
}

// ---------------------------------------------------------------- text with positions (for ZPL)
function inflate(o) {
  if (!o?.stream) return Buffer.alloc(0);
  return /\/FlateDecode/.test(o.dict || '') ? (() => { try { return zlib.inflateSync(o.stream); } catch { return zlib.inflateRawSync(o.stream.subarray(2)); } })() : o.stream;
}
function cmapOf(text) {
  const map = new Map();
  for (const b of text.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) for (const m of b[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g)) map.set(parseInt(m[1], 16), hexUtf16(m[2]));
  for (const b of text.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const m of b[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*(<([0-9a-fA-F]+)>|\[([^\]]*)\])/g)) {
      const lo = parseInt(m[1], 16), hi = parseInt(m[2], 16);
      if (m[4]) { const base = parseInt(m[4], 16); for (let c = lo; c <= hi; c++) map.set(c, String.fromCodePoint(base + c - lo)); }
      else [...m[5].matchAll(/<([0-9a-fA-F]+)>/g)].forEach((x, k) => map.set(lo + k, hexUtf16(x[1])));
    }
  }
  return map;
}
const hexUtf16 = h => { let s = ''; for (let i = 0; i + 4 <= h.length; i += 4) s += String.fromCharCode(parseInt(h.slice(i, i + 4), 16)); return s; };
const mul = (a, b) => [a[0] * b[0] + a[1] * b[2], a[0] * b[1] + a[1] * b[3], a[2] * b[0] + a[3] * b[2], a[2] * b[1] + a[3] * b[3], a[4] * b[0] + a[5] * b[2] + b[4], a[4] * b[1] + a[5] * b[3] + b[5]];
// the text runs of every page: { width, height, runs: [{ x, y (from the top), size, text }] }
export function pdfTextRuns(buf) {
  const doc = readObjects(Buffer.from(buf));
  const pages = [];
  for (const p of pagesOf(doc)) {
    const o = doc.objs.get(p.num);
    const box = (rawValue(o.dict, 'MediaBox') || p.inherited.MediaBox || '[0 0 612 792]').match(/-?[\d.]+/g).map(Number);
    const W = box[2] - box[0], H = box[3] - box[1];
    let res = rawValue(o.dict, 'Resources') || p.inherited.Resources || '';
    if (/^\d+\s+\d+\s+R$/.test(res)) res = doc.objs.get(Number(res.split(/\s+/)[0]))?.dict || '';
    let fontsDict = rawValue(res, 'Font') || '';
    if (/^\d+\s+\d+\s+R$/.test(fontsDict)) fontsDict = doc.objs.get(Number(fontsDict.split(/\s+/)[0]))?.dict || '';
    const fonts = {};
    for (const m of fontsDict.matchAll(/\/([^\s/<>[\]()]+)\s+(\d+)\s+\d+\s+R/g)) {
      const fd = doc.objs.get(Number(m[2]))?.dict || '';
      const tu = refOf(fd, 'ToUnicode');
      fonts[m[1]] = { cid: /Identity-H|Type0/.test(fd), map: tu ? cmapOf(inflate(doc.objs.get(tu)).toString('latin1')) : null };
    }
    const contents = rawValue(o.dict, 'Contents');
    const refs = contents ? (contents.startsWith('[') ? [...contents.matchAll(/(\d+)\s+\d+\s+R/g)].map(x => Number(x[1])) : [Number(contents.split(/\s+/)[0])]) : [];
    const ops = refs.map(r => inflate(doc.objs.get(r)).toString('latin1')).join('\n');
    const runs = [];
    let ctm = [1, 0, 0, 1, 0, 0], tm = [1, 0, 0, 1, 0, 0], lm = tm, font = null, size = 10, lead = 0;
    const stack = [];
    const stackOps = [];
    const decode = str => {
      if (!font) return str;
      if (font.cid) { let t = ''; for (let i = 0; i + 1 < str.length; i += 2) { const c = (str.charCodeAt(i) << 8) | str.charCodeAt(i + 1); t += font.map?.get(c) ?? ''; } return t; }
      return font.map ? [...str].map(ch => font.map.get(ch.charCodeAt(0)) ?? ch).join('') : str;
    };
    const emit = str => {
      const text = decode(str).replace(/[\0-\x1f]/g, '');
      if (!text.trim()) return;
      const m = mul(tm, ctm);
      const sz = Math.abs(size * Math.hypot(m[2], m[3])) || size;
      runs.push({ x: m[4] - box[0], y: H - (m[5] - box[1]), size: sz, text });
    };
    // tokenizer: numbers, names, strings, hex strings, arrays, operators
    const tokRe = /\s*(?:(\((?:\\[\s\S]|[^\\)])*\))|<([0-9a-fA-F\s]*)>|(\/[^\s/<>[\]()]+)|(-?[\d.]+)|(\[)|(\])|([A-Za-z'"*]+[0-9]?))/gy;
    let t;
    let operands = [];
    const str = lit => lit.slice(1, -1).replace(/\\([nrtbf()\\]|[0-7]{1,3}|\r?\n)/g, (a, e) => ({ n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', '(': '(', ')': ')', '\\': '\\' })[e] ?? (/^[0-7]+$/.test(e) ? String.fromCharCode(parseInt(e, 8)) : ''));
    while (tokRe.lastIndex < ops.length) {
      const before = tokRe.lastIndex;
      t = tokRe.exec(ops);
      if (!t) { tokRe.lastIndex = before + 1; continue; }
      if (t[1] !== undefined) operands.push({ s: str(t[1]) });
      else if (t[2] !== undefined) { const h = t[2].replace(/\s/g, ''); let v = ''; for (let i = 0; i < h.length; i += 2) v += String.fromCharCode(parseInt(h.slice(i, i + 2).padEnd(2, '0'), 16)); operands.push({ s: v }); }
      else if (t[3] !== undefined) operands.push({ n: t[3].slice(1) });
      else if (t[4] !== undefined) operands.push(Number(t[4]));
      else if (t[5] !== undefined) { stackOps.push(operands); operands = []; }
      else if (t[6] !== undefined) { const arr = operands; operands = stackOps.pop() || []; operands.push({ a: arr }); }
      else {
        const op = t[7], a = operands;
        operands = [];
        switch (op) {
          case 'q': stack.push(ctm); break;
          case 'Q': ctm = stack.pop() || [1, 0, 0, 1, 0, 0]; break;
          case 'cm': ctm = mul(a.slice(0, 6), ctm); break;
          case 'BT': tm = lm = [1, 0, 0, 1, 0, 0]; break;
          case 'Tf': font = fonts[a[0]?.n] || null; size = a[1] || size; break;
          case 'TL': lead = a[0]; break;
          case 'Tm': tm = lm = a.slice(0, 6); break;
          case 'Td': lm = mul([1, 0, 0, 1, a[0], a[1]], lm); tm = lm; break;
          case 'TD': lead = -a[1]; lm = mul([1, 0, 0, 1, a[0], a[1]], lm); tm = lm; break;
          case 'T*': lm = mul([1, 0, 0, 1, 0, -lead], lm); tm = lm; break;
          case 'Tj': emit(a[0]?.s ?? ''); break;
          case "'": lm = mul([1, 0, 0, 1, 0, -lead], lm); tm = lm; emit(a[0]?.s ?? ''); break;
          case 'TJ': emit((a[0]?.a || []).filter(x => x.s !== undefined).map(x => x.s).join('')); break;
          default: break;
        }
      }
    }
    pages.push({ width: W, height: H, runs });
  }
  return pages;
}

// ---------------------------------------------------------------- printer languages
const converter = () => {
  for (const [cmd, args] of [['pdftops', ['-level2', '-', '-']], ['gs', ['-q', '-dNOPAUSE', '-dBATCH', '-dSAFER', '-sDEVICE=ps2write', '-sOutputFile=-', '-']]]) {
    const v = spawnSync(cmd, cmd === 'gs' ? ['--version'] : ['-v'], { encoding: 'utf8' });
    if (!v.error) return { cmd, args };
  }
  return null;
};
const zplText = s => `^FH^FD${String(s).replace(/[_^~]/g, c => `_${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`).replace(/[^\x20-\x7e]/g, c => [...Buffer.from(c, 'utf8')].map(b => `_${b.toString(16).toUpperCase()}`).join(''))}^FS`;
export function pdfToZpl(pdf, { dpi = 203 } = {}) {
  const k = dpi / 72;
  return pdfTextRuns(pdf).map(p => {
    const lines = [`^XA`, `^CI28`, `^PW${Math.round(p.width * k)}`, `^LL${Math.round(p.height * k)}`];
    for (const r of p.runs) {
      const h = Math.max(10, Math.round(r.size * k));
      lines.push(`^FO${Math.max(0, Math.round(r.x * k))},${Math.max(0, Math.round((r.y - r.size * 0.8) * k))}^A0N,${h},${h}${zplText(r.text)}`);
    }
    lines.push('^XZ');
    return lines.join('\n');
  }).join('\n');
}
// the print data of a PDF in a printer language: { format, data, warning }
export function toPdl(pdf, format) {
  const f = String(format || 'PDF').toUpperCase();
  if (f === 'ZPL') return { format: 'ZPL', data: Buffer.from(pdfToZpl(pdf), 'utf8') };
  if (f === 'PS' || f === 'POSTSCRIPT') {
    const c = converter();
    if (c) {
      const r = spawnSync(c.cmd, c.args, { input: Buffer.from(pdf), maxBuffer: 256 << 20 });
      if (r.status === 0 && r.stdout?.length) return { format: 'PS', data: r.stdout };
      return { format: 'PDF', data: Buffer.from(pdf), warning: `PostScript conversion with ${c.cmd} failed: ${String(r.stderr || '').trim().slice(0, 200)}; the print data is PDF` };
    }
    return { format: 'PDF', data: Buffer.from(pdf), warning: 'PostScript needs pdftops (poppler) or Ghostscript on this machine; the print data is PDF' };
  }
  return { format: 'PDF', data: Buffer.from(pdf) };
}
