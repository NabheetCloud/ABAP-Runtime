// A small Word (.docx) writer for the delivery documents (no dependencies): title, headings, paragraphs, bullets,
// code blocks, tables with a shaded header row and coloured status cells, PNG/JPEG images, header and footer.
// The document is WordprocessingML in a ZIP container (deflate, written here as well).
import zlib from 'node:zlib';

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
const CM = 567;          // twips per cm
const EMU_CM = 360000;   // EMU per cm
const BRAND = '0A6ED1';
const STATUS = { pass: 'D9F2E1', passed: 'D9F2E1', fixed: 'D9F2E1', ok: 'D9F2E1', fail: 'F9D6D5', failed: 'F9D6D5', error: 'F9D6D5', defect: 'F9D6D5', warning: 'FCEBC7', known: 'FCEBC7', info: 'E3EEFA', skipped: 'EDEDED' };

// the text of a run, keeping line breaks and tabs
function runs(text, { bold, italic, mono, size, color } = {}) {
  const props = `${bold ? '<w:b/>' : ''}${italic ? '<w:i/>' : ''}${mono ? '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/>' : ''}${color ? `<w:color w:val="${color}"/>` : ''}${size ? `<w:sz w:val="${size * 2}"/><w:szCs w:val="${size * 2}"/>` : ''}`;
  const rPr = props ? `<w:rPr>${props}</w:rPr>` : '';
  return String(text ?? '').split('\n').map((line, i) => `${i ? `<w:r>${rPr}<w:br/></w:r>` : ''}<w:r>${rPr}<w:t xml:space="preserve">${esc(line)}</w:t></w:r>`).join('');
}
// **bold** inside a paragraph text
const rich = (text, opts) => String(text ?? '').split(/(\*\*[^*]+\*\*)/).map(p => /^\*\*[^*]+\*\*$/.test(p) ? runs(p.slice(2, -2), { ...opts, bold: true }) : runs(p, opts)).join('');

export class Docx {
  constructor({ header = '', footer = '' } = {}) {
    this.body = [];
    this.media = [];
    this.header = header;
    this.footer = footer;
  }
  title(text, sub) {
    this.body.push(`<w:p><w:pPr><w:spacing w:after="60"/></w:pPr>${runs(text, { bold: true, size: 24, color: BRAND })}</w:p>`);
    if (sub) this.body.push(`<w:p><w:pPr><w:spacing w:after="200"/></w:pPr>${runs(sub, { bold: true, size: 13 })}</w:p>`);
    return this;
  }
  heading(text, level = 1) {
    this.body.push(`<w:p><w:pPr><w:pStyle w:val="Heading${level}"/><w:keepNext/></w:pPr>${runs(text)}</w:p>`);
    return this;
  }
  para(text, opts = {}) {
    this.body.push(`<w:p><w:pPr><w:spacing w:after="120"/></w:pPr>${rich(text, opts)}</w:p>`);
    return this;
  }
  bullets(items) {
    for (const t of items) this.body.push(`<w:p><w:pPr><w:pStyle w:val="ListBullet"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>${rich(t)}</w:p>`);
    return this;
  }
  code(text) {
    const lines = String(text ?? '').replace(/\s+$/, '').split('\n');
    lines.forEach((l, i) => this.body.push(`<w:p><w:pPr><w:pStyle w:val="Code"/>${i === lines.length - 1 ? '<w:spacing w:after="160"/>' : ''}</w:pPr>${runs(l, { mono: true, size: 8 })}</w:p>`));
    return this;
  }
  // head: column titles; rows: arrays of cell texts; widths in cm (sum about 17); status: index of a status column
  table(head, rows, { widths, status } = {}) {
    const n = head.length;
    const w = (widths || head.map(() => 17 / n)).map(x => Math.round(x * CM));
    const cell = (text, i, { fill, bold } = {}) => `<w:tc><w:tcPr><w:tcW w:w="${w[i]}" w:type="dxa"/>${fill ? `<w:shd w:val="clear" w:color="auto" w:fill="${fill}"/>` : ''}</w:tcPr><w:p><w:pPr><w:spacing w:before="20" w:after="20"/></w:pPr>${runs(text, { bold, size: 8.5 })}</w:p></w:tc>`;
    const border = ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(b => `<w:${b} w:val="single" w:sz="4" w:space="0" w:color="B8C2CC"/>`).join('');
    const tr = (cells, header) => `<w:tr>${header ? '<w:trPr><w:tblHeader/></w:trPr>' : ''}${cells.map((c, i) => cell(c, i, header ? { fill: 'DCE8F5', bold: true } : { fill: i === status ? STATUS[String(c).toLowerCase()] : undefined })).join('')}</w:tr>`;
    this.body.push(`<w:tbl><w:tblPr><w:tblW w:w="${w.reduce((a, b) => a + b, 0)}" w:type="dxa"/><w:tblLayout w:type="fixed"/><w:tblBorders>${border}</w:tblBorders><w:tblCellMar><w:left w:w="80" w:type="dxa"/><w:right w:w="80" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>${w.map(x => `<w:gridCol w:w="${x}"/>`).join('')}</w:tblGrid>${tr(head, true)}${rows.map(r => tr(r.map(c => c ?? ''), false)).join('')}</w:tbl>`);
    this.body.push('<w:p><w:pPr><w:spacing w:after="80"/></w:pPr></w:p>');
    return this;
  }
  // a PNG or JPEG image, widthCm wide, with a caption below
  image(buf, caption, widthCm = 16.5) {
    const size = imageSize(buf);
    if (!size) return this.para(`[image missing] ${caption || ''}`, { italic: true });
    const id = this.media.length + 1, ext = size.type;
    this.media.push({ name: `image${id}.${ext}`, data: buf, rid: `rIdImg${id}` });
    const cx = Math.round(widthCm * EMU_CM), cy = Math.round(cx * size.h / size.w);
    this.body.push(`<w:p><w:pPr><w:keepNext/><w:jc w:val="center"/><w:spacing w:before="120" w:after="40"/></w:pPr><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${id}" name="Picture ${id}"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${id}" name="image${id}.${ext}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rIdImg${id}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:ln w="6350"><a:solidFill><a:srgbClr val="B8C2CC"/></a:solidFill></a:ln></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`);
    if (caption) this.body.push(`<w:p><w:pPr><w:jc w:val="center"/><w:spacing w:after="200"/></w:pPr>${runs(caption, { italic: true, size: 8.5 })}</w:p>`);
    return this;
  }
  pageBreak() { this.body.push('<w:p><w:r><w:br w:type="page"/></w:r></w:p>'); return this; }

  toBuffer() {
    const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
    const doc = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document ${W} xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><w:body>${this.body.join('')}<w:sectPr><w:headerReference w:type="default" r:id="rIdHeader"/><w:footerReference w:type="default" r:id="rIdFooter"/><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="567" w:footer="567" w:gutter="0"/></w:sectPr></w:body></w:document>`;
    const hf = (tag, text, page) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:${tag} ${W}><w:p><w:pPr><w:tabs><w:tab w:val="right" w:pos="9638"/></w:tabs></w:pPr>${runs(text, { size: 8, color: '5B6475' })}${page ? `<w:r><w:rPr><w:sz w:val="16"/><w:color w:val="5B6475"/></w:rPr><w:tab/><w:t xml:space="preserve">Page </w:t></w:r><w:r><w:rPr><w:sz w:val="16"/><w:color w:val="5B6475"/></w:rPr><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:rPr><w:sz w:val="16"/></w:rPr><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r><w:r><w:rPr><w:sz w:val="16"/></w:rPr><w:fldChar w:fldCharType="end"/></w:r>` : ''}</w:p></w:${tag}>`;
    const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles ${W}>
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri" w:eastAsia="Calibri"/><w:sz w:val="20"/><w:szCs w:val="20"/><w:lang w:val="en-GB"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="80" w:line="264" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="280" w:after="100"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:color w:val="${BRAND}"/><w:sz w:val="28"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="200" w:after="80"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:sz w:val="23"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="ListBullet"><w:name w:val="List Bullet"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="40"/><w:ind w:left="360" w:hanging="240"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="Code"><w:name w:val="Code"/><w:basedOn w:val="Normal"/><w:pPr><w:shd w:val="clear" w:color="auto" w:fill="F3F5F8"/><w:spacing w:after="0" w:line="240" w:lineRule="auto"/><w:ind w:left="113" w:right="113"/></w:pPr></w:style>
</w:styles>`;
    const numbering = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:numbering ${W}><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="360" w:hanging="240"/></w:pPr></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>`;
    const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
<Relationship Id="rIdNumbering" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>
<Relationship Id="rIdHeader" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/>
<Relationship Id="rIdFooter" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>
${this.media.map(m => `<Relationship Id="${m.rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${m.name}"/>`).join('\n')}</Relationships>`;
    const types = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>
<Default Extension="png" ContentType="image/png"/><Default Extension="jpeg" ContentType="image/jpeg"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>
<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>
<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>
</Types>`;
    const root = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;
    return zip([
      ['[Content_Types].xml', types], ['_rels/.rels', root], ['word/document.xml', doc], ['word/styles.xml', styles],
      ['word/numbering.xml', numbering], ['word/header1.xml', hf('hdr', this.header)], ['word/footer1.xml', hf('ftr', this.footer, true)],
      ['word/_rels/document.xml.rels', rels], ...this.media.map(m => [`word/media/${m.name}`, m.data]),
    ]);
  }
}

// width / height of a PNG or JPEG
export function imageSize(buf) {
  if (!buf || buf.length < 24) return null;
  if (buf.readUInt32BE(0) === 0x89504e47) return { type: 'png', w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    for (let i = 2; i < buf.length - 9;) {
      if (buf[i] !== 0xff) return null;
      const marker = buf[i + 1], len = buf.readUInt16BE(i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { type: 'jpeg', h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
      i += 2 + len;
    }
  }
  return null;
}

// a ZIP archive of [name, string | Buffer] entries (deflated)
export function zip(entries) {
  const locals = [], central = [];
  let offset = 0;
  for (const [name, content] of entries) {
    const data = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
    const packed = zlib.deflateRawSync(data), crc = zlib.crc32(data), fn = Buffer.from(name, 'utf8');
    const h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0x0800, 6); h.writeUInt16LE(8, 8);
    h.writeUInt32LE(0x00210000, 10);   // 01.01.1980 00:00
    h.writeUInt32LE(crc, 14); h.writeUInt32LE(packed.length, 18); h.writeUInt32LE(data.length, 22); h.writeUInt16LE(fn.length, 26);
    locals.push(h, fn, packed);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8); c.writeUInt16LE(8, 10);
    c.writeUInt32LE(0x00210000, 12); c.writeUInt32LE(crc, 16); c.writeUInt32LE(packed.length, 20); c.writeUInt32LE(data.length, 24);
    c.writeUInt16LE(fn.length, 28); c.writeUInt32LE(offset, 42);
    central.push(c, fn);
    offset += 30 + fn.length + packed.length;
  }
  const cd = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}
