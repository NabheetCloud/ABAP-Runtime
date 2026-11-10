// Fonts of XDP layouts: OpenType fonts with CFF outlines (.otf, embedded whole as FontFile3 /OpenType), faces of
// TrueType / OpenType collections (.ttc), the regular face of a family without the asked style, SAP's 72 from the
// app's fonts/ folder (no network), the parser of the name table. System fonts of macOS are used when present.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { renderXdp } from '../src/forms/xfa/render.js';
import { resolveFont } from '../src/forms/xfa/fonts.js';
import { readTtf, fontFaces, extractFace } from '../src/forms/ttf.js';

process.env.RAP_NO_FONT_DOWNLOAD = '1';
const cache = fs.mkdtempSync(path.join(os.tmpdir(), 'rap-fonts-'));
process.env.RAP_FONT_CACHE = cache;
after(() => fs.rmSync(cache, { recursive: true, force: true }));

const OTF = '/System/Library/Fonts/Supplemental/STIXGeneral.otf';
const TTC = '/System/Library/Fonts/Helvetica.ttc';
const CFF_TTC = '/System/Library/Fonts/Kohinoor.ttc';
const has = f => fs.existsSync(f);
const xdpWith = fonts => `<?xml version="1.0"?><xdp:xdp xmlns:xdp="http://ns.adobe.com/xdp/"><template xmlns="http://www.xfa.org/schema/xfa-template/3.3/"><subform name="f" layout="tb">
  <pageSet><pageArea name="P"><contentArea x="20mm" y="20mm" w="170mm" h="250mm"/><medium short="210mm" long="297mm"/></pageArea></pageSet>
  ${fonts.map(([tf, w, t], i) => `<draw name="D${i}" w="170mm" h="10mm"><ui><textEdit/></ui><value><text>${t}</text></value><font typeface="${tf}" size="14pt"${w ? ` weight="${w}"` : ''}/></draw>`).join('')}
</subform></template></xdp:xdp>`;
// the decompressed content of the PDF's streams (to find the font dictionaries' keys)
const objects = pdf => pdf.toString('latin1');

test('OpenType CFF font: metrics, cmap, embedded as FontFile3 /OpenType with a CIDFontType0', { skip: !has(OTF) && 'no .otf font on this system' }, () => {
  const t = readTtf(fs.readFileSync(OTF));
  assert.equal(t.cff, true);
  assert.ok(t.glyph(65) > 0 && t.width(t.glyph(65)) > 0);
  assert.equal(t.names.family, 'STIXGeneral');
  assert.equal(t.subset([t.glyph(65)]), t.buf);              // CFF: the whole font program
  const f = resolveFont('STIXGeneral', 'normal', 'normal');
  assert.equal(f.file, OTF);
  assert.equal(resolveFont('STIXGeneral', 'bold', 'normal').file, OTF);   // no bold file under the family's name: regular
  const r = renderXdp(xdpWith([['STIXGeneral', '', 'STIX OpenType']]), null);
  assert.deepEqual(r.warnings, []);
  const s = objects(r.pdf);
  assert.match(s, /\/Subtype \/CIDFontType0 /);
  assert.match(s, /\/FontFile3 \d+ 0 R/);
  assert.match(s, /\/Subtype \/OpenType/);
  assert.doesNotMatch(s.match(/\/Subtype \/CIDFontType0 [^>]*>>/)[0], /CIDToGIDMap/);
});

test('font collections: faces with their names, one face as a font file, a style picked from a .ttc', { skip: !has(TTC) && 'no .ttc font on this system' }, () => {
  const buf = fs.readFileSync(TTC);
  const faces = fontFaces(buf);
  assert.ok(faces.length > 1);
  const bold = faces.find(f => f.style === 'Bold');
  assert.ok(bold, JSON.stringify(faces));
  const face = readTtf(extractFace(buf, bold.index));
  assert.equal(face.names.style, 'Bold');
  assert.equal(readTtf(buf).names.style, faces[0].style);   // a collection read directly: its first face
  const f = resolveFont('Helvetica Neue', 'bold', 'normal');
  if (has('/System/Library/Fonts/HelveticaNeue.ttc')) { assert.match(f.file, /HelveticaNeue-Bold\.ttf$/); assert.ok(f.file.startsWith(cache)); }
  const r = renderXdp(xdpWith([['Optima', '', 'Optima from a collection']]), null);
  if (has('/System/Library/Fonts/Optima.ttc')) assert.deepEqual(r.warnings, []);
});

test('a CFF face of a collection embeds as OpenType', { skip: !has(CFF_TTC) && 'no CFF collection on this system' }, () => {
  const faces = fontFaces(fs.readFileSync(CFF_TTC));
  assert.ok(faces.every(f => f.cff));
  const t = readTtf(extractFace(fs.readFileSync(CFF_TTC), 0));
  assert.equal(t.cff, true);
  assert.equal(t.buf.toString('latin1', 0, 4), 'OTTO');
});

test("SAP's 72 without network: from the app's fonts folder (a .ttf, or SAP's WOFF converted once); the warning says how", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rap-72-'));
  try {
    const miss = resolveFont('72 Brand Medium', 'normal', 'normal', [dir]);
    assert.ok(!miss.file);
    assert.match(miss.substitute, /fonts\/ folder/);
    // a WOFF built from a system TrueType font stands in for 72-Semibold-full.woff
    const src = ['/System/Library/Fonts/Supplemental/Arial.ttf', '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf'].find(has);
    if (!src) return;
    fs.writeFileSync(path.join(dir, '72-Semibold-full.woff'), toWoff(fs.readFileSync(src)));
    const f = resolveFont('72 Brand Medium', 'normal', 'normal', [dir]);
    assert.ok(f.file && f.file.startsWith(cache), JSON.stringify(f));
    assert.ok(readTtf(fs.readFileSync(f.file)).glyph(65) > 0);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// a TrueType font as WOFF 1.0 (tables compressed)
function toWoff(ttf) {
  const n = ttf.readUInt16BE(4), entries = [];
  for (let i = 0; i < n; i++) { const r = 12 + i * 16; entries.push({ tag: ttf.toString('latin1', r, r + 4), sum: ttf.readUInt32BE(r + 4), data: ttf.subarray(ttf.readUInt32BE(r + 8), ttf.readUInt32BE(r + 8) + ttf.readUInt32BE(r + 12)) }); }
  const head = Buffer.alloc(44 + n * 20), body = [];
  head.write('wOFF', 0, 'latin1'); head.writeUInt32BE(ttf.readUInt32BE(0), 4); head.writeUInt16BE(n, 12);
  let off = head.length;
  entries.forEach((e, i) => {
    const z = zlib.deflateSync(e.data), use = z.length < e.data.length ? z : e.data, pad = (4 - (use.length % 4)) % 4, r = 44 + i * 20;
    head.write(e.tag, r, 'latin1'); head.writeUInt32BE(off, r + 4); head.writeUInt32BE(use.length, r + 8); head.writeUInt32BE(e.data.length, r + 12); head.writeUInt32BE(e.sum, r + 16);
    body.push(use, Buffer.alloc(pad)); off += use.length + pad;
  });
  const out = Buffer.concat([head, ...body]);
  out.writeUInt32BE(out.length, 8);
  return out;
}
