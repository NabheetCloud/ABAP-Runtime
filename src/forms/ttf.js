// TrueType fonts for print forms: read the metrics and the character map of a .ttf file and write a subset with
// only the glyphs a document uses (the glyph numbers stay, so the PDF can address glyphs directly: Identity-H).
// Any script the font covers works (Latin, Greek, Cyrillic, CJK, …). OpenType fonts with CFF outlines (.otf) are read
// too (their font program is embedded whole: no subset); font collections (.ttc / .otc) give their faces.

const SFNT = new Set([0x00010000, 0x74727565, 0x4f54544f]);   // TrueType, 'true' (Apple), 'OTTO' (CFF)
// the table directory of the face at an offset (a collection's offsets are absolute)
function tableDir(buf, at = 0) {
  const tables = {}, n = buf.readUInt16BE(at + 4);
  for (let i = 0; i < n; i++) {
    const r = at + 12 + i * 16;
    tables[buf.toString('latin1', r, r + 4)] = { offset: buf.readUInt32BE(r + 8), length: buf.readUInt32BE(r + 12) };
  }
  return tables;
}
// the faces of a font file: a collection ('ttcf') has several, any other font one
export function fontFaces(buf) {
  buf = Buffer.from(buf);
  const at = buf.readUInt32BE(0) === 0x74746366 ? Array.from({ length: buf.readUInt32BE(8) }, (_, i) => buf.readUInt32BE(12 + i * 4)) : [0];
  return at.map((offset, index) => ({ index, offset, cff: buf.readUInt32BE(offset) === 0x4f54544f, ...fontNames(buf, tableDir(buf, offset)) }));
}
// family / style / full / PostScript name from the name table (Windows Unicode or Mac Roman records)
function fontNames(buf, tables) {
  const t = tables.name;
  if (!t) return {};
  const nm = buf.subarray(t.offset, t.offset + t.length), count = nm.readUInt16BE(2), strings = nm.readUInt16BE(4);
  const out = {};
  for (let i = 0; i < count; i++) {
    const r = 6 + i * 12, pid = nm.readUInt16BE(r), eid = nm.readUInt16BE(r + 2), lang = nm.readUInt16BE(r + 4), id = nm.readUInt16BE(r + 6), len = nm.readUInt16BE(r + 8), off = nm.readUInt16BE(r + 10);
    const key = { 1: 'family', 2: 'style', 4: 'full', 6: 'postscript', 16: 'family', 17: 'style' }[id];
    if (!key) continue;
    const raw = nm.subarray(strings + off, strings + off + len);
    let v = null;
    if (pid === 3 || pid === 0) { if (pid === 3 && lang !== 0x409 && out[key]) continue; v = Buffer.from(raw).swap16().toString('utf16le'); }
    else if (pid === 1 && eid === 0 && !out[key]) v = raw.toString('latin1');
    if (v !== null && (!out[key] || id >= 16 || (pid === 3 && lang === 0x409))) out[key] = v;
  }
  return out;
}
// one face of a collection as a font file of its own
export function extractFace(buf, index = 0) {
  buf = Buffer.from(buf);
  if (buf.readUInt32BE(0) !== 0x74746366) return buf;
  const at = buf.readUInt32BE(12 + index * 4);
  const tables = tableDir(buf, at), out = {};
  for (const [tag, t] of Object.entries(tables)) out[tag] = buf.subarray(t.offset, t.offset + t.length);
  return writeTables(out, buf.readUInt32BE(at));
}

export function readTtf(buf) {
  buf = Buffer.from(buf);
  let sig = buf.readUInt32BE(0);
  if (sig === 0x74746366) { buf = extractFace(buf, 0); sig = buf.readUInt32BE(0); }   // a collection: its first face
  if (!SFNT.has(sig)) throw new Error('Not a TrueType or OpenType font (.ttf, .otf, .ttc)');
  const cff = sig === 0x4f54544f;
  const tables = tableDir(buf);
  for (const t of ['head', 'hhea', 'maxp', 'hmtx', 'cmap', ...(cff ? ['CFF '] : ['loca', 'glyf'])]) if (!tables[t] && !(cff && t === 'CFF ' && tables['CFF2'])) throw new Error(`The font has no ${t.trim()} table`);
  if (cff && !tables['CFF ']) throw new Error('OpenType fonts with CFF2 (variable) outlines are not supported; use a static .otf or a .ttf');
  const tab = t => buf.subarray(tables[t].offset, tables[t].offset + tables[t].length);
  const head = tab('head'), hhea = tab('hhea'), maxp = tab('maxp');
  const unitsPerEm = head.readUInt16BE(18), longLoca = head.readInt16BE(50) === 1;
  const bbox = [head.readInt16BE(36), head.readInt16BE(38), head.readInt16BE(40), head.readInt16BE(42)];
  const numGlyphs = maxp.readUInt16BE(4), numH = hhea.readUInt16BE(34);
  const hmtx = tab('hmtx');
  const advance = gid => hmtx.readUInt16BE(4 * Math.min(gid, numH - 1));
  const offsets = [];
  if (!cff) { const loca = tab('loca'); for (let g = 0; g <= numGlyphs; g++) offsets.push(longLoca ? loca.readUInt32BE(g * 4) : loca.readUInt16BE(g * 2) * 2); }
  // the character map: format 12 (full Unicode) or format 4 (BMP), Windows or Unicode platform
  const cmap = tab('cmap'), map = new Map();
  const subs = [];
  for (let i = 0; i < cmap.readUInt16BE(2); i++) {
    const p = cmap.readUInt16BE(4 + i * 8), e = cmap.readUInt16BE(6 + i * 8), off = cmap.readUInt32BE(8 + i * 8);
    subs.push({ p, e, off, format: cmap.readUInt16BE(off) });
  }
  const pick = subs.find(s => s.format === 12 && (s.p === 3 || s.p === 0)) || subs.find(s => s.format === 4 && ((s.p === 3 && (s.e === 1 || s.e === 10)) || s.p === 0));
  if (!pick) throw new Error('The font has no Unicode character map');
  if (pick.format === 12) {
    const groups = cmap.readUInt32BE(pick.off + 12);
    for (let i = 0; i < groups; i++) {
      const r = pick.off + 16 + i * 12, start = cmap.readUInt32BE(r), end = cmap.readUInt32BE(r + 4), g0 = cmap.readUInt32BE(r + 8);
      for (let c = start; c <= end && c - start < 0x30000; c++) map.set(c, g0 + c - start);
    }
  } else {
    const o = pick.off, segX2 = cmap.readUInt16BE(o + 6), seg = segX2 / 2;
    const ends = o + 14, starts = ends + segX2 + 2, deltas = starts + segX2, ranges = deltas + segX2;
    for (let i = 0; i < seg; i++) {
      const end = cmap.readUInt16BE(ends + i * 2), start = cmap.readUInt16BE(starts + i * 2), delta = cmap.readInt16BE(deltas + i * 2), ro = cmap.readUInt16BE(ranges + i * 2);
      for (let c = start; c <= end && c !== 0xffff; c++) {
        let g;
        if (ro === 0) g = (c + delta) & 0xffff;
        else { const at = ranges + i * 2 + ro + (c - start) * 2; g = cmap.readUInt16BE(at); if (g) g = (g + delta) & 0xffff; }
        if (g) map.set(c, g);
      }
    }
  }
  const os2 = tables['OS/2'] ? tab('OS/2') : null, post = tables.post ? tab('post') : null;
  const ascent = os2 && os2.length > 72 ? os2.readInt16BE(68) : hhea.readInt16BE(4);
  const descent = os2 && os2.length > 72 ? os2.readInt16BE(70) : hhea.readInt16BE(6);
  const capHeight = os2 && os2.readUInt16BE(0) >= 2 && os2.length > 90 ? os2.readInt16BE(88) : ascent;
  const italicAngle = post ? post.readInt32BE(4) / 65536 : 0;
  const scale = v => Math.round(v * 1000 / unitsPerEm);
  return {
    buf, tables, unitsPerEm, numGlyphs, cff, names: fontNames(buf, tables),
    bbox: bbox.map(scale), ascent: scale(ascent), descent: scale(descent), capHeight: scale(capHeight), italicAngle,
    glyph: cp => map.get(cp) || 0,
    has: cp => map.has(cp),
    width: gid => scale(advance(gid)),
    // the subset: the used glyphs (with the parts of composite glyphs) keep their data, all others are empty
    subset(used) {
      if (cff) return buf;   // CFF outlines: the whole font program (FontFile3 /OpenType)
      const glyf = tab('glyf'), keep = new Set([0, ...used]);
      const todo = [...keep];
      while (todo.length) {
        const g = todo.pop(), start = offsets[g], end = offsets[g + 1];
        if (end <= start || glyf.readInt16BE(start) >= 0) continue;
        let p = start + 10, flags;
        do {
          flags = glyf.readUInt16BE(p);
          const comp = glyf.readUInt16BE(p + 2);
          if (!keep.has(comp)) { keep.add(comp); todo.push(comp); }
          p += 4 + (flags & 1 ? 4 : 2) + (flags & 8 ? 2 : flags & 0x40 ? 4 : flags & 0x80 ? 8 : 0);
        } while (flags & 0x20);
      }
      const parts = [], newLoca = Buffer.alloc((numGlyphs + 1) * 4);
      let pos = 0;
      for (let g = 0; g < numGlyphs; g++) {
        newLoca.writeUInt32BE(pos, g * 4);
        if (keep.has(g) && offsets[g + 1] > offsets[g]) {
          const d = glyf.subarray(offsets[g], offsets[g + 1]);
          const pad = (4 - (d.length % 4)) % 4;
          parts.push(d, Buffer.alloc(pad)); pos += d.length + pad;
        }
      }
      newLoca.writeUInt32BE(pos, numGlyphs * 4);
      const newHead = Buffer.from(tab('head'));
      newHead.writeUInt32BE(0, 8);       // checkSumAdjustment
      newHead.writeInt16BE(1, 50);       // long loca
      const out = { head: newHead, loca: newLoca, glyf: Buffer.concat(parts) };
      // (no cmap: the PDF addresses the glyphs by number)
      for (const t of ['hhea', 'maxp', 'hmtx', 'cvt ', 'fpgm', 'prep', 'OS/2', 'post', 'name']) if (tables[t]) out[t] = tab(t);
      return writeTables(out);
    },
  };
}

function checksum(b) {
  const p = Buffer.concat([b, Buffer.alloc((4 - (b.length % 4)) % 4)]);
  let s = 0;
  for (let i = 0; i < p.length; i += 4) s = (s + p.readUInt32BE(i)) >>> 0;
  return s;
}
function writeTables(tables, version = 0x00010000) {
  const tags = Object.keys(tables).sort();
  const n = tags.length, es = Math.floor(Math.log2(n)), sr = 2 ** es * 16;
  const dir = Buffer.alloc(12 + n * 16);
  dir.writeUInt32BE(version, 0); dir.writeUInt16BE(n, 4); dir.writeUInt16BE(sr, 6); dir.writeUInt16BE(es, 8); dir.writeUInt16BE(n * 16 - sr, 10);
  let off = dir.length;
  const body = [];
  tags.forEach((t, i) => {
    const d = tables[t], pad = (4 - (d.length % 4)) % 4;
    dir.write(t, 12 + i * 16, 'latin1'); dir.writeUInt32BE(checksum(d), 16 + i * 16); dir.writeUInt32BE(off, 20 + i * 16); dir.writeUInt32BE(d.length, 24 + i * 16);
    body.push(d, Buffer.alloc(pad)); off += d.length + pad;
  });
  return Buffer.concat([dir, ...body]);
}
