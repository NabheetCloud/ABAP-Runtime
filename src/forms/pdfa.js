// PDF/A-2b (ISO 19005-2, archiving): what the writer adds to a document for it: an sRGB output intent with its ICC
// profile, XMP metadata matching the document information, and embedded fonts for the text the standard fonts would
// draw (Arimo, metrically compatible with Helvetica / Arial; SIL Open Font License).
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

// an ICC profile (version 2, display class) of sRGB: D50-adapted primaries, gamma 2.2 curves
export function srgbProfile() {
  const s15 = v => { const b = Buffer.alloc(4); b.writeInt32BE(Math.round(v * 65536)); return b; };
  const xyz = (x, y, z) => Buffer.concat([Buffer.from('XYZ \0\0\0\0', 'latin1'), s15(x), s15(y), s15(z)]);
  const curv = Buffer.concat([Buffer.from('curv\0\0\0\0', 'latin1'), Buffer.from([0, 0, 0, 1, 0x02, 0x33])]);   // gamma 2.2 (u8Fixed8)
  const name = 'sRGB IEC61966-2.1';
  const desc = Buffer.concat([Buffer.from('desc\0\0\0\0', 'latin1'), (() => { const b = Buffer.alloc(4); b.writeUInt32BE(name.length + 1); return b; })(), Buffer.from(`${name}\0`, 'latin1'), Buffer.alloc(4 + 4 + 2 + 1 + 67)]);
  const cprt = Buffer.from('text\0\0\0\0No copyright, use freely\0', 'latin1');
  const tags = [['desc', desc], ['cprt', cprt], ['wtpt', xyz(0.9642, 1, 0.8249)], ['rXYZ', xyz(0.4361, 0.2225, 0.0139)], ['gXYZ', xyz(0.3851, 0.7169, 0.0971)], ['bXYZ', xyz(0.1431, 0.0606, 0.7141)], ['rTRC', curv], ['gTRC', curv], ['bTRC', curv]];
  const pad = b => Buffer.concat([b, Buffer.alloc((4 - (b.length % 4)) % 4)]);
  let offset = 128 + 4 + tags.length * 12;
  const table = Buffer.alloc(4 + tags.length * 12), data = [];
  table.writeUInt32BE(tags.length);
  const seen = new Map();
  tags.forEach(([sig, body], k) => {
    let at = seen.get(body);   // the three curves share one copy
    if (at === undefined) { at = offset; seen.set(body, at); const p = pad(body); data.push(p); offset += p.length; }
    table.write(sig, 4 + k * 12, 'latin1'); table.writeUInt32BE(at, 8 + k * 12); table.writeUInt32BE(body.length, 12 + k * 12);
  });
  const header = Buffer.alloc(128);
  header.writeUInt32BE(offset, 0);
  header.writeUInt32BE(0x02100000, 8);
  header.write('mntr', 12, 'latin1'); header.write('RGB ', 16, 'latin1'); header.write('XYZ ', 20, 'latin1');
  [2026, 1, 1, 0, 0, 0].forEach((v, k) => header.writeUInt16BE(v, 24 + k * 2));
  header.write('acsp', 36, 'latin1');
  s15(0.9642).copy(header, 68); s15(1).copy(header, 72); s15(0.8249).copy(header, 76);
  return Buffer.concat([header, table, ...data]);
}

const xml = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// the XMP metadata of a PDF/A-2b document (title, author, dates and producer as in the document information)
export function xmp({ title = '', author = '', producer = 'RAP Studio', date = new Date() }) {
  const d = date.toISOString().replace(/\.\d+Z$/, 'Z');
  return Buffer.from(`<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about="" xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmlns:pdf="http://ns.adobe.com/pdf/1.3/">
   <pdfaid:part>2</pdfaid:part>
   <pdfaid:conformance>B</pdfaid:conformance>
   <dc:format>application/pdf</dc:format>
   ${title ? `<dc:title><rdf:Alt><rdf:li xml:lang="x-default">${xml(title)}</rdf:li></rdf:Alt></dc:title>` : ''}
   ${author ? `<dc:creator><rdf:Seq><rdf:li>${xml(author)}</rdf:li></rdf:Seq></dc:creator>` : ''}
   <xmp:CreateDate>${d}</xmp:CreateDate>
   <xmp:ModifyDate>${d}</xmp:ModifyDate>
   <xmp:MetadataDate>${d}</xmp:MetadataDate>
   <xmp:CreatorTool>${xml(producer)}</xmp:CreatorTool>
   <pdf:Producer>${xml(producer)}</pdf:Producer>
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`, 'utf8');
}

// the TrueType files of the embedded replacement of the standard fonts: regular, bold, italic, bold italic
const require = createRequire(import.meta.url);
export function pdfaFonts() {
  let dir;
  try { dir = path.dirname(require.resolve('@expo-google-fonts/arimo/package.json')); } catch { return null; }
  const f = n => fs.readFileSync(path.join(dir, n, `Arimo_${n}.ttf`));
  return { regular: f('400Regular'), bold: f('700Bold'), italic: f('400Regular_Italic'), bolditalic: f('700Bold_Italic') };
}
