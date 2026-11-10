// A small PDF writer for print forms (no dependencies): pages with text in the standard PDF fonts (WinAnsi) or in
// embedded TrueType fonts (subset, any Unicode script), lines, rectangles, JPEG and PNG images (PNG transparency as a
// soft mask), rotated and transparent text (watermarks), fillable form fields (AcroForm: text, multi-line text,
// check boxes, drop-down lists, signature fields) and digital signatures (PKCS#7 detached, see sign.js).
// Coordinates are points from the top left (y down), as the form layout works; the writer turns them around.
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { readTtf } from './ttf.js';
import { srgbProfile, xmp } from './pdfa.js';
import { securityHandler, encryptStrings } from './crypt.js';

// glyph widths (1/1000 em) of Helvetica and Helvetica-Bold for ASCII 32..126 (Adobe AFM); Courier is fixed
const HELV = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584];
const HELVB = [278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,389,280,389,584];
export const FONTS = { Helvetica: 'F1', 'Helvetica-Bold': 'F2', 'Helvetica-Oblique': 'F3', 'Helvetica-BoldOblique': 'F4', Courier: 'F5', 'Courier-Bold': 'F6', 'Times-Roman': 'F7', 'Times-Bold': 'F8' };
export function textWidth(text, font, size) {
  const s = String(text);
  if (/^Courier/.test(font)) return s.length * 0.6 * size;
  const tab = /Bold/.test(font) ? HELVB : HELV, times = /^Times/.test(font) ? 0.92 : 1;
  let w = 0;
  for (const ch of s) { const c = ch.charCodeAt(0); w += c >= 32 && c <= 126 ? tab[c - 32] : 556; }
  return w / 1000 * size * times;
}
// Unicode -> WinAnsi (cp1252) bytes; characters it cannot show become '?'
const CP1252 = { 0x20ac: 0x80, 0x201a: 0x82, 0x192: 0x83, 0x201e: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87, 0x2c6: 0x88, 0x2030: 0x89, 0x160: 0x8a, 0x2039: 0x8b, 0x152: 0x8c, 0x17d: 0x8e,
  0x2018: 0x91, 0x2019: 0x92, 0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97, 0x2dc: 0x98, 0x2122: 0x99, 0x161: 0x9a, 0x203a: 0x9b, 0x153: 0x9c, 0x17e: 0x9e, 0x178: 0x9f };
function pdfString(text) {
  let out = '';
  for (const ch of String(text)) {
    const c = ch.codePointAt(0);
    const b = c < 0x80 || (c >= 0xa0 && c <= 0xff) ? c : CP1252[c] ?? 0x3f;
    out += b === 0x28 || b === 0x29 || b === 0x5c ? `\\${String.fromCharCode(b)}` : b < 0x20 || b > 0x7e ? `\\${b.toString(8).padStart(3, '0')}` : String.fromCharCode(b);
  }
  return `(${out})`;
}
const num = n => (Math.round(Number(n) * 100) / 100).toString();
export const SIG_HEX = 16384;   // room for the PKCS#7 signature (hex digits)
const pdfDate = d => `D:${d.toISOString().replace(/[-:T]/g, '').slice(0, 14)}Z`;
// a value of a multi-line field in lines of the width (Helvetica)
function wrapLines(text, width, size) {
  const out = [];
  for (const para of String(text).split('\n')) {
    let line = '';
    for (const w of para.split(/(\s+)/)) {
      if (line && textWidth(line + w, 'Helvetica', size) > width && w.trim()) { out.push(line.trimEnd()); line = w.trimStart(); } else line += w;
    }
    out.push(line);
  }
  return out;
}
const col = c => (c || [0, 0, 0]).map(v => num(v / 255)).join(' ');

// images: JPEG as is (DCTDecode); PNG decoded (8 bit gray, RGB, palette, with alpha) and deflated again
export function readImage(buf) {
  buf = Buffer.from(buf);
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    for (let i = 2; i < buf.length;) {
      if (buf[i] !== 0xff) { i++; continue; }
      const m = buf[i + 1], len = buf.readUInt16BE(i + 2);
      if (m >= 0xc0 && m <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(m)) {
        const comps = buf[i + 9];
        return { width: buf.readUInt16BE(i + 7), height: buf.readUInt16BE(i + 5), color: comps === 1 ? 'DeviceGray' : comps === 4 ? 'DeviceCMYK' : 'DeviceRGB', filter: 'DCTDecode', data: buf };
      }
      i += 2 + len;
    }
    throw new Error('Unreadable JPEG image');
  }
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('Images must be PNG or JPEG');
  let p = 8, w, h, depth, type, palette, idat = [], trns;
  while (p < buf.length) {
    const len = buf.readUInt32BE(p), kind = buf.toString('ascii', p + 4, p + 8), d = buf.subarray(p + 8, p + 8 + len);
    if (kind === 'IHDR') { w = d.readUInt32BE(0); h = d.readUInt32BE(4); depth = d[8]; type = d[9]; if (d[12]) throw new Error('Interlaced PNG images are not supported'); }
    else if (kind === 'PLTE') palette = d;
    else if (kind === 'tRNS') trns = d;
    else if (kind === 'IDAT') idat.push(d);
    else if (kind === 'IEND') break;
    p += 12 + len;
  }
  if (depth !== 8) throw new Error('PNG images need 8 bits per channel');
  const ch = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[type], bpp = ch, stride = w * bpp;
  const raw = zlib.inflateSync(Buffer.concat(idat)), px = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {   // PNG row filters
    const f = raw[y * (stride + 1)], src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)), row = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? px[row + x - bpp] : 0, b = y ? px[row - stride + x] : 0, c = x >= bpp && y ? px[row - stride + x - bpp] : 0;
      const pr = () => { const q = a + b - c, pa = Math.abs(q - a), pb = Math.abs(q - b), pc = Math.abs(q - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c; };
      px[row + x] = (src[x] + [0, a, b, (a + b) >> 1, pr()][f]) & 0xff;
    }
  }
  const color = Buffer.alloc(w * h * (type === 0 || type === 4 ? 1 : 3)), alpha = type === 4 || type === 6 || (type === 3 && trns) ? Buffer.alloc(w * h) : null;
  for (let i = 0; i < w * h; i++) {
    if (type === 0) color[i] = px[i];
    else if (type === 4) { color[i] = px[i * 2]; alpha[i] = px[i * 2 + 1]; }
    else if (type === 2) px.copy(color, i * 3, i * 3, i * 3 + 3);
    else if (type === 6) { px.copy(color, i * 3, i * 4, i * 4 + 3); alpha[i] = px[i * 4 + 3]; }
    else { const k = px[i]; palette.copy(color, i * 3, k * 3, k * 3 + 3); if (alpha) alpha[i] = k < trns.length ? trns[k] : 255; }
  }
  return { width: w, height: h, color: type === 0 || type === 4 ? 'DeviceGray' : 'DeviceRGB', filter: 'FlateDecode', data: zlib.deflateSync(color), alpha: alpha && zlib.deflateSync(alpha) };
}

// a text string for the document's dictionaries (field values, info): PDFDocEncoding, or UTF-16 beyond Latin-1
export function docString(text) {
  const s = String(text ?? '');
  if ([...s].every(ch => ch.codePointAt(0) < 0x100)) return pdfString(s);
  const b = Buffer.from(`\ufeff${s}`, 'utf16le').swap16();
  return `<${b.toString('hex')}>`;
}
// characters the standard fonts can show (WinAnsi)
export const winAnsi = cp => cp < 0x80 || (cp >= 0xa0 && cp <= 0xff) || CP1252[cp] !== undefined;

export class Pdf {
  constructor({ title = '', author = 'RAP Studio' } = {}) { this.pages = []; this.images = []; this.fonts = new Map(); this.fields = []; this.title = title; this.author = author; }
  addPage(width, height) { this.page = { width, height, ops: [], annots: [] }; this.pages.push(this.page); return this.page; }
  // an embedded TrueType font under a name (used like the standard fonts: text(…, { font: name }))
  addFont(name, ttf) {
    if (!this.fonts.has(name)) this.fonts.set(name, { ttf: readTtf(ttf), used: new Map(), id: `E${this.fonts.size + 1}` });
    return name;
  }
  textWidth(text, font, size) {
    const f = this.fonts.get(font);
    if (!f) return textWidth(text, font, size);
    let w = 0;
    for (const ch of String(text)) w += f.ttf.width(f.ttf.glyph(ch.codePointAt(0)));
    return w / 1000 * size;
  }
  // characters a font cannot show
  missing(text, font) {
    const f = this.fonts.get(font);
    return [...new Set([...String(text)].filter(ch => { const cp = ch.codePointAt(0); return cp >= 0x20 && (f ? !f.ttf.has(cp) : !winAnsi(cp)); }))];
  }
  text(x, y, text, { font = 'Helvetica', size = 10, color, angle = 0, opacity } = {}) {
    const H = this.page.height, emb = this.fonts.get(font), f = emb ? emb.id : FONTS[font] || 'F1';
    const gs = opacity !== undefined && opacity < 1 ? `/GS${Math.round(opacity * 100)} gs ` : '';
    if (gs) (this.opacities ||= new Set()).add(Math.round(opacity * 100));
    const r = angle * Math.PI / 180, cs = Math.cos(r), sn = Math.sin(r);
    let str;
    if (emb) {
      str = '<';
      for (const ch of String(text)) { const cp = ch.codePointAt(0), g = emb.ttf.glyph(cp); emb.used.set(g, cp); str += g.toString(16).padStart(4, '0'); }
      str += '>';
    } else str = pdfString(text);
    this.page.ops.push(`q ${gs}BT /${f} ${num(size)} Tf ${col(color)} rg ${num(cs)} ${num(sn)} ${num(-sn)} ${num(cs)} ${num(x)} ${num(H - y)} Tm ${str} Tj ET Q`);
  }
  // a fillable field on the current page: { type: 'text' | 'multiline' | 'checkbox' | 'dropdown' | 'signature', name,
  // x, y, w, h, value, options, required, readOnly, size, tooltip, js (a calculation) }
  field(f) {
    const fd = { ...f, page: this.page }; this.fields.push(fd); this.page.annots.push(fd);
    // fields drawn with an embedded font (PDF/A): its glyphs of the value
    const emb = this.fonts.get(f.font) || (this.fieldFont && this.fonts.get(this.fieldFont));
    if (emb) for (const ch of `${f.value ?? ''}${(f.options || []).join('')}`) { const cp = ch.codePointAt(0); emb.used.set(emb.ttf.glyph(cp), cp); }
    // a field in its own (embedded) font: the glyphs a user may type (Latin-1) are kept in the subset
    if (f.font && emb) for (let cp = 32; cp < 256; cp++) { if (cp === 127 || (cp > 127 && cp < 160)) continue; const g = emb.ttf.glyph(cp); if (g) emb.used.set(g, cp); }
    return fd;
  }
  // a text as a string operand of a font (embedded fonts: glyph ids)
  encode(text, font) {
    const emb = this.fonts.get(font);
    if (!emb) return pdfString(text);
    let str = '<';
    for (const ch of String(text)) { const cp = ch.codePointAt(0), g = emb.ttf.glyph(cp); emb.used.set(g, cp); str += g.toString(16).padStart(4, '0'); }
    return `${str}>`;
  }
  line(x1, y1, x2, y2, { color = [176, 186, 197], width = 0.6, dash } = {}) {
    const H = this.page.height;
    this.page.ops.push(`q ${col(color)} RG ${num(width)} w ${dash ? `[${dash.join(' ')}] 0 d ` : ''}${num(x1)} ${num(H - y1)} m ${num(x2)} ${num(H - y2)} l S Q`);
  }
  rect(x, y, w, h, { fill, stroke, width = 0.6, radius = 0 } = {}) {
    const H = this.page.height;
    if (!fill && !stroke) return;
    const paint = fill && stroke ? 'B' : fill ? 'f' : 'S';
    this.page.ops.push(`q ${fill ? `${col(fill)} rg ` : ''}${stroke ? `${col(stroke)} RG ${num(width)} w ` : ''}${num(x)} ${num(H - y - h)} ${num(w)} ${num(h)} re ${paint} Q`);
    void radius;
  }
  image(img, x, y, w, h) {
    let k = this.images.indexOf(img);
    if (k < 0) { this.images.push(img); k = this.images.length - 1; }
    this.page.ops.push(`q ${num(w)} 0 0 ${num(h)} ${num(x)} ${num(this.page.height - y - h)} cm /Im${k} Do Q`);
  }
  // the document as bytes; { signature: { field, name, reason, location, contact } } leaves room for a signature
  // (sign.js fills it in)
  // { pdfa: true }: PDF/A-2b (only embedded fonts: the standard fonts must not be used, set fieldFont; no JavaScript);
  // { encrypt: { userPassword, ownerPassword, permissions } }: AES-256
  render({ signature, pdfa, encrypt } = {}) {
    if (pdfa && encrypt) throw new Error('A PDF/A document cannot be encrypted');
    if (signature && encrypt) throw new Error('Signing an encrypted PDF is not supported: sign it first, without encryption');
    const objs = [];
    const add = body => { objs.push(body); return objs.length; };
    const stream = (dict, data) => Buffer.concat([Buffer.from(`<< ${dict} /Length ${data.length} >>\nstream\n`), data, Buffer.from('\nendstream')]);
    const catalog = add(null), pagesId = add(null);
    const fontIds = pdfa ? {} : Object.fromEntries(Object.entries(FONTS).map(([name, f]) => [f, add(`<< /Type /Font /Subtype /Type1 /BaseFont /${name} /Encoding /WinAnsiEncoding >>`)]));
    const zadb = !pdfa && this.fields.some(f => f.type === 'checkbox' || f.type === 'radio') ? add('<< /Type /Font /Subtype /Type1 /BaseFont /ZapfDingbats >>') : null;
    // embedded fonts: Type0 with a CIDFontType2 descendant (TrueType, subset) or CIDFontType0 (OpenType with CFF
    // outlines, embedded whole as FontFile3 /OpenType), glyph ids as character codes (Identity-H)
    for (const [name, f] of this.fonts) {
      if (!f.used.size) continue;
      const t = f.ttf, gids = [...f.used.keys()].sort((a, b) => a - b);
      const tag = name.toUpperCase().replace(/[^A-Z]/g, '').padEnd(6, 'X').slice(0, 6);
      const base = `${tag}+${name.replace(/[^A-Za-z0-9-]/g, '')}`;
      const sub = t.subset(gids), file = zlib.deflateSync(sub);
      const fileId = add(stream(t.cff ? '/Filter /FlateDecode /Subtype /OpenType' : `/Filter /FlateDecode /Length1 ${sub.length}`, file));
      const desc = add(`<< /Type /FontDescriptor /FontName /${base} /Flags 32 /FontBBox [${t.bbox.join(' ')}] /ItalicAngle ${num(t.italicAngle)} /Ascent ${t.ascent} /Descent ${t.descent} /CapHeight ${t.capHeight} /StemV 80 /${t.cff ? 'FontFile3' : 'FontFile2'} ${fileId} 0 R >>`);
      const widths = gids.map(g => `${g} [${t.width(g)}]`).join(' ');
      const cid = add(`<< /Type /Font /Subtype /${t.cff ? 'CIDFontType0' : 'CIDFontType2'} /BaseFont /${base} /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor ${desc} 0 R /W [${widths}] /DW 1000${t.cff ? '' : ' /CIDToGIDMap /Identity'} >>`);
      const u16 = cp => Buffer.from(String.fromCodePoint(cp), 'utf16le').swap16().toString('hex');
      const bf = gids.map(g => `<${g.toString(16).padStart(4, '0')}> <${u16(f.used.get(g))}>`);
      const chunks = [];
      for (let i = 0; i < bf.length; i += 100) chunks.push(`${Math.min(100, bf.length - i)} beginbfchar\n${bf.slice(i, i + 100).join('\n')}\nendbfchar`);
      const cmap = `/CIDInit /ProcSet findresource begin 12 dict begin begincmap /CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def /CMapName /Adobe-Identity-UCS def /CMapType 2 def 1 begincodespacerange <0000> <FFFF> endcodespacerange\n${chunks.join('\n')}\nendcmap CMapName currentdict /CMap defineresource pop end end`;
      const toUni = add(stream('/Filter /FlateDecode', zlib.deflateSync(Buffer.from(cmap, 'latin1'))));
      fontIds[f.id] = add(`<< /Type /Font /Subtype /Type0 /BaseFont /${base} /Encoding /Identity-H /DescendantFonts [${cid} 0 R] /ToUnicode ${toUni} 0 R >>`);
    }
    const imgIds = this.images.map(img => {
      const smask = img.alpha ? add(stream(`/Type /XObject /Subtype /Image /Width ${img.width} /Height ${img.height} /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode`, img.alpha)) : null;
      return add(stream(`/Type /XObject /Subtype /Image /Width ${img.width} /Height ${img.height} /ColorSpace /${img.color} /BitsPerComponent 8 /Filter /${img.filter}${smask ? ` /SMask ${smask} 0 R` : ''}`, img.data));
    });
    const gs = [...(this.opacities || [])].map(o => `/GS${o} << /Type /ExtGState /ca ${num(o / 100)} /CA ${num(o / 100)} >>`).join(' ');
    const resources = `<< /Font << ${Object.entries(fontIds).map(([f, id]) => `/${f} ${id} 0 R`).join(' ')} >> /XObject << ${imgIds.map((id, k) => `/Im${k} ${id} 0 R`).join(' ')} >>${gs ? ` /ExtGState << ${gs} >>` : ''} >>`;
    // pages first get their numbers: the fields point to their page
    const pageIds = this.pages.map(() => add(null));
    const fieldIds = [], calcIds = [];
    let sigValue = null;
    const ff = pdfa ? this.fonts.get(this.fieldFont) : null;   // the font of the fields (PDF/A: embedded)
    if (pdfa && this.fields.length && !ff) throw new Error('PDF/A: the fields need an embedded font (fieldFont)');
    const helvDoc = ff ? fontIds[ff.id] : fontIds.F1, fresDoc = ff ? ff.id : 'Helv', ffDoc = ff;
    let helv = helvDoc, fres = fresDoc;
    // JavaScript actions of a field (not in PDF/A): calculate, validate, keystroke, format, focus, blur, mouse up
    const AA = { calculate: 'C', validate: 'V', keystroke: 'K', format: 'F', focus: 'Fo', blur: 'Bl', mouseUp: 'U' };
    const actions = f => {
      if (pdfa) return '';
      const a = { ...(f.js ? { calculate: f.js } : {}), ...(f.actions || {}) };
      const keys = Object.keys(a).filter(k => AA[k] && a[k]);
      return keys.length ? ` /AA << ${keys.map(k => `/${AA[k]} << /S /JavaScript /JS ${pdfString(a[k])} >>`).join(' ')} >>` : '';
    };
    const radioGroups = new Map();
    const fieldFonts = new Set();
    for (const f of this.fields) {
      const H = f.page.height, rect = `[${num(f.x)} ${num(H - f.y - f.h)} ${num(f.x + f.w)} ${num(H - f.y)}]`;
      const size = f.size || (f.type === 'multiline' ? 9 : Math.min(10, f.h * 0.6));
      const common = `/Type /Annot /Subtype /Widget /T ${docString(f.name)}${f.tooltip ? ` /TU ${docString(f.tooltip)}` : ''} /Rect ${rect} /F 4 /P ${pageIds[this.pages.indexOf(f.page)]} 0 R`;
      const flags = (f.readOnly ? 1 : 0) | (f.required ? 2 : 0);
      const mk = '/MK << /BC [0.58 0.64 0.72] /BG [0.97 0.98 1] >>';
      const xobj = (content, fonts) => add(stream(`/Type /XObject /Subtype /Form /BBox [0 0 ${num(f.w)} ${num(f.h)}] /Resources << /Font << ${fonts} >> >>`, Buffer.from(content, 'latin1')));
      const box = `0.97 0.98 1 rg 0 0 ${num(f.w)} ${num(f.h)} re f 0.58 0.64 0.72 RG 0.6 w 0.3 0.3 ${num(f.w - 0.6)} ${num(f.h - 0.6)} re S`;
      if (f.type === 'radio') {
        // a radio button: a widget of its group (the field), on state = the export value
        let g = radioGroups.get(f.group);
        if (!g) { g = { id: add(null), kids: [], value: null, flags, required: f.required }; radioGroups.set(f.group, g); fieldIds.push(g.id); }
        const st = `/${String(f.export ?? '1').replace(/[^A-Za-z0-9_.-]/g, c => `#${c.charCodeAt(0).toString(16).padStart(2, '0')}`) || '1'}`;
        if (f.value) g.value = st;
        const r = Math.min(f.w, f.h) / 2, k = 0.5523 * r, cx = f.w / 2, cy = f.h / 2;
        const circle = rr => `${num(cx + rr)} ${num(cy)} m ${num(cx + rr)} ${num(cy + rr * 0.5523)} ${num(cx + rr * 0.5523)} ${num(cy + rr)} ${num(cx)} ${num(cy + rr)} c ${num(cx - rr * 0.5523)} ${num(cy + rr)} ${num(cx - rr)} ${num(cy + rr * 0.5523)} ${num(cx - rr)} ${num(cy)} c ${num(cx - rr)} ${num(cy - rr * 0.5523)} ${num(cx - rr * 0.5523)} ${num(cy - rr)} ${num(cx)} ${num(cy - rr)} c ${num(cx + rr * 0.5523)} ${num(cy - rr)} ${num(cx + rr)} ${num(cy - rr * 0.5523)} ${num(cx + rr)} ${num(cy)} c h`;
        void k;
        const ring = `q 0.97 0.98 1 rg 0.58 0.64 0.72 RG 0.6 w ${circle(r - 0.4)} B Q`;
        const on = xobj(`${ring} q 0 g ${circle(r * 0.45)} f Q`, ''), off = xobj(ring, '');
        const kid = add(`<< /Type /Annot /Subtype /Widget /Parent ${g.id} 0 R /Rect ${rect} /F 4 /P ${pageIds[this.pages.indexOf(f.page)]} 0 R${f.tooltip ? ` /TU ${docString(f.tooltip)}` : ''} /AS ${f.value ? st : '/Off'}${zadb ? ' /DA (/ZaDb 0 Tf 0 g)' : ''} /MK << /CA (l) /BC [0.58 0.64 0.72] /BG [0.97 0.98 1] >> /AP << /N << ${st} ${on} 0 R /Off ${off} 0 R >> >>${actions(f)} >>`);
        g.kids.push(kid);
        f.id = kid;
        continue;
      }
      if (f.type === 'checkbox') {
        // the check mark: ZapfDingbats 4, or drawn (PDF/A: no fonts that are not embedded)
        const mark = zadb ? `q BT /ZaDb ${num(f.h * 0.8)} Tf 0 g ${num(f.w * 0.15)} ${num(f.h * 0.2)} Td (4) Tj ET Q` : `q 0 G ${num(Math.max(1, f.h * 0.12))} w 1 J 1 j ${num(f.w * 0.22)} ${num(f.h * 0.52)} m ${num(f.w * 0.42)} ${num(f.h * 0.25)} l ${num(f.w * 0.8)} ${num(f.h * 0.78)} l S Q`;
        const res = zadb ? `/ZaDb ${zadb} 0 R` : '';
        const on = xobj(`${box} ${mark}`, res), off = xobj(box, res);
        const v = f.value ? '/Yes' : '/Off';
        fieldIds.push(add(`<< ${common} /FT /Btn /Ff ${flags} /V ${v} /AS ${v}${zadb ? ' /DA (/ZaDb 0 Tf 0 g)' : ''} /MK << /CA (4) /BC [0.58 0.64 0.72] /BG [0.97 0.98 1] >> /AP << /N << /Yes ${on} 0 R /Off ${off} 0 R >> >>${actions(f)} >>`));
      } else if (f.type === 'signature') {
        let v = '';
        if (signature && (!signature.field || signature.field === f.name)) {
          // room for the signature: ByteRange and Contents are filled in after the document is written
          sigValue = add(`<< /Type /Sig /Filter /Adobe.PPKLite /SubFilter /adbe.pkcs7.detached /ByteRange [0 ********** ********** **********] /Contents <${'0'.repeat(SIG_HEX)}> /M ${pdfString(pdfDate(new Date()))}${signature.name ? ` /Name ${docString(signature.name)}` : ''}${signature.reason ? ` /Reason ${docString(signature.reason)}` : ''}${signature.location ? ` /Location ${docString(signature.location)}` : ''}${signature.contact ? ` /ContactInfo ${docString(signature.contact)}` : ''} >>`);
          v = ` /V ${sigValue} 0 R`;
          signature = { ...signature, done: true };
        }
        const ap = xobj(`0.97 0.98 1 rg 0 0 ${num(f.w)} ${num(f.h)} re f 0.58 0.64 0.72 RG 0.6 w 0 0.3 m ${num(f.w)} 0.3 l S`, `/${fres} ${helv} 0 R`);
        fieldIds.push(add(`<< ${common} /FT /Sig${v} /Ff ${flags} /AP << /N ${ap} 0 R >> >>`));
      } else {
        const multi = f.type === 'multiline', combo = f.type === 'dropdown';
        const value = String(f.value ?? '');
        const own = !pdfa && f.font && this.fonts.get(f.font);
        const fres = own ? own.id : fresDoc, helv = own ? fontIds[own.id] : helvDoc, ff = own || ffDoc, encFont = own ? f.font : this.fieldFont;
        if (own) fieldFonts.add(own.id);
        const shownText = String(f.display ?? value);   // the appearance: the formatted value (a format action shows it the same way)
        const lines = multi ? wrapLines(shownText, f.w - 4, size) : [shownText];
        const text = lines.map((l, k) => `BT /${fres} ${num(size)} Tf ${f.color ? f.color.map(c => num(c / 255)).join(' ') : '0 0 0'} rg ${num(f.align === 'right' ? Math.max(2, f.w - 2 - (own ? this.textWidth(l, f.font, size) : size * 0.5 * l.length)) : f.align === 'center' ? Math.max(2, (f.w - (own ? this.textWidth(l, f.font, size) : size * 0.5 * l.length)) / 2) : 2)} ${num(multi ? f.h - 2 - size * (k + 1) * 1.15 + 2 : (f.h - size * 0.7) / 2)} Td ${ff ? this.encode(l, encFont) : pdfString(l)} Tj ET`).join(' ');
        const ap = xobj(`${box} /Tx BMC q 1 1 ${num(f.w - 2)} ${num(f.h - 2)} re W n ${text} Q EMC`, `/${fres} ${helv} 0 R`);
        const opts = combo ? ` /Opt [${(f.options || []).map(o => docString(o)).join(' ')}]` : '';
        const fflags = flags | (multi ? 4096 : 0) | (combo ? 131072 : 0);
        const aa = actions(f);
        fieldIds.push(add(`<< ${common} /FT /${combo ? 'Ch' : 'Tx'} /Ff ${fflags}${opts} /V ${docString(value)} /DA (/${fres} ${num(size)} Tf ${f.color ? f.color.map(c => num(c / 255)).join(' ') : '0'} ${f.color ? 'rg' : 'g'})${f.align === 'right' ? ' /Q 2' : f.align === 'center' ? ' /Q 1' : ''} ${mk}${f.maxLength ? ` /MaxLen ${f.maxLength}` : ''}${aa} /AP << /N ${ap} 0 R >> >>`));
        if (f.js || f.actions?.calculate) calcIds.push(fieldIds.at(-1));
      }
      f.id = fieldIds.at(-1);
    }
    for (const [name, g] of radioGroups) objs[g.id - 1] = `<< /FT /Btn /Ff ${49152 | g.flags} /T ${docString(name)} /V ${g.value || '/Off'} /Kids [${g.kids.map(id => `${id} 0 R`).join(' ')}] >>`;
    if (signature && !signature.done) throw new Error(`The form has no signature field${signature.field ? ` ${signature.field}` : ''} to sign`);
    this.pages.forEach((p, i) => {
      const content = add(stream('/Filter /FlateDecode', zlib.deflateSync(Buffer.from(p.ops.join('\n'), 'latin1'))));
      const annots = p.annots.length ? ` /Annots [${p.annots.map(f => `${f.id} 0 R`).join(' ')}]` : '';
      objs[pageIds[i] - 1] = `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${num(p.width)} ${num(p.height)}] /Resources ${resources} /Contents ${content} 0 R${annots} >>`;
    });
    const acro = fieldIds.length ? ` /AcroForm << /Fields [${fieldIds.map(id => `${id} 0 R`).join(' ')}] /DA (/${fres} 0 Tf 0 g) /DR << /Font << /${fres} ${helv} 0 R${[...fieldFonts].filter(id => id !== fres).map(id => ` /${id} ${fontIds[id]} 0 R`).join('')}${zadb ? ` /ZaDb ${zadb} 0 R` : ''} >> >>${this.fields.some(f => f.type === 'signature') ? ' /SigFlags 3' : ''}${calcIds.length ? ` /CO [${calcIds.map(id => `${id} 0 R`).join(' ')}]` : ''} >>` : '';
    const now = new Date();
    let meta = '';
    if (pdfa) {
      // PDF/A-2b: XMP metadata (as the document information) and the sRGB output intent
      const icc = srgbProfile();
      const iccId = add(stream('/N 3 /Filter /FlateDecode', zlib.deflateSync(icc)));
      const xmpData = xmp({ title: this.title, author: this.author, date: now });
      const metaId = add(stream('/Type /Metadata /Subtype /XML', xmpData));
      meta = ` /Metadata ${metaId} 0 R /OutputIntents [<< /Type /OutputIntent /S /GTS_PDFA1 /OutputConditionIdentifier (sRGB IEC61966-2.1) /Info (sRGB IEC61966-2.1) /RegistryName (http://www.color.org) /DestOutputProfile ${iccId} 0 R >>]`;
    }
    const docJs = !pdfa && this.docJs ? add(`<< /S /JavaScript /JS ${pdfString(this.docJs)} >>`) : null;
    objs[catalog - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R${acro}${meta}${docJs ? ` /Names << /JavaScript << /Names [(RAPStudio) ${docJs} 0 R] >> >>` : ''} >>`;
    objs[pagesId - 1] = `<< /Type /Pages /Kids [${pageIds.map(id => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;
    const info = add(`<< /Producer (RAP Studio) /Title ${docString(this.title)}${this.author || !pdfa ? ` /Author ${docString(this.author)}` : ''} /CreationDate ${pdfString(pdfDate(now))}${pdfa ? ` /ModDate ${pdfString(pdfDate(now))}` : ''} >>`);
    const id = crypto.randomBytes(16).toString('hex');
    // encryption: every string and stream of the document with the file key (the Encrypt dictionary itself not)
    let encId = null;
    if (encrypt) {
      const h = securityHandler(encrypt);
      for (let k = 0; k < objs.length; k++) {
        const o = objs[k];
        if (Buffer.isBuffer(o)) {
          const at = o.indexOf('\nstream\n'), end = o.lastIndexOf('\nendstream');
          const dict = o.subarray(0, at).toString('latin1'), data = h.encrypt(o.subarray(at + 8, end));
          objs[k] = Buffer.concat([Buffer.from(encryptStrings(dict.replace(/\/Length \d+/, `/Length ${data.length}`), h.encrypt), 'latin1'), Buffer.from('\nstream\n'), data, Buffer.from('\nendstream')]);
        } else objs[k] = encryptStrings(o, h.encrypt);
      }
      encId = add(h.dict);
    }
    const parts = [Buffer.from(`%PDF-${pdfa || encrypt ? '1.7' : '1.4'}\n%\xe2\xe3\xcf\xd3\n`, 'latin1')];
    const offsets = [];
    let size = parts[0].length;
    objs.forEach((o, i) => {
      const b = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`), Buffer.isBuffer(o) ? o : Buffer.from(o, 'latin1'), Buffer.from('\nendobj\n')]);
      offsets.push(size); size += b.length; parts.push(b);
    });
    const xref = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map(o => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R /ID [<${id}> <${id}>]${encId ? ` /Encrypt ${encId} 0 R` : ''} >>\nstartxref\n${size}\n%%EOF\n`;
    parts.push(Buffer.from(xref, 'latin1'));
    return Buffer.concat(parts);
  }
}
