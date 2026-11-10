// Barcodes for print forms: Code 128 (code set B, switching to C for runs of digits), EAN-13 and QR codes
// (qrcode-generator, MIT) here; every other symbology through bwip-js (MIT, Barcode Writer in Pure PostScript):
// Code 39, Code 93, EAN-8, UPC-A / UPC-E, ITF / ITF-14, Codabar, GS1-128, Data Matrix, PDF417, Aztec, MaxiCode, …
// (any bwip-js symbology name works, e.g. "gs1datamatrix", "isbn"). The result is what to draw: bars [{ x, w }] in
// modules, or a matrix of dark modules (modules wide, rows high; PDF417 is not square).
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const qrcode = require('qrcode-generator');
const bwip = require('bwip-js');

// Code 128 bar patterns (bar/space widths) for values 0..106
const C128 = ['212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213', '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132', '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211', '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313', '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331', '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111', '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214', '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111', '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141', '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141', '114131', '311141', '411131', '211412', '211214', '211232', '2331112'];
function code128(text) {
  const s = String(text);
  const codes = [];
  let set = null, i = 0;
  const digitsAt = k => { let n = 0; while (k + n < s.length && /\d/.test(s[k + n])) n++; return n; };
  while (i < s.length) {
    const run = digitsAt(i);
    if (run >= 4 || (set === 'C' && run >= 2)) {
      if (set !== 'C') { codes.push(set === null ? 105 : 99); set = 'C'; }
      const pairs = Math.floor(run / 2);
      for (let p = 0; p < pairs; p++, i += 2) codes.push(Number(s.substr(i, 2)));
      continue;
    }
    if (set !== 'B') { codes.push(set === null ? 104 : 100); set = 'B'; }
    const c = s.charCodeAt(i++);
    if (c < 32 || c > 126) throw new Error(`Code 128 cannot encode character ${JSON.stringify(String.fromCharCode(c))}`);
    codes.push(c - 32);
  }
  let check = codes[0];
  for (let k = 1; k < codes.length; k++) check += codes[k] * k;
  codes.push(check % 103, 106);
  const bars = [];
  let x = 10;   // quiet zone
  for (const c of codes) [...C128[c]].forEach((w, k) => { if (k % 2 === 0) bars.push({ x, w: Number(w) }); x += Number(w); });
  return { bars, width: x + 10 };
}
// EAN-13: 12 digits (+ check digit computed when missing)
const L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
const R = L.map(p => [...p].map(b => (b === '1' ? '0' : '1')).join(''));   // R: L inverted
const G = R.map(p => [...p].reverse().join(''));                              // G: R mirrored
const PARITY = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];
function ean13(text) {
  let d = String(text).replace(/\D/g, '');
  if (d.length === 12) d += (10 - ([...d].reduce((a, c, k) => a + Number(c) * (k % 2 ? 3 : 1), 0) % 10)) % 10;
  if (d.length !== 13) throw new Error('EAN-13 needs 12 or 13 digits');
  let bits = '101';
  for (let k = 1; k <= 6; k++) bits += (PARITY[d[0]][k - 1] === 'L' ? L : G)[d[k]];
  bits += '01010';
  for (let k = 7; k <= 12; k++) bits += R[d[k]];
  bits += '101';
  const bars = [];
  [...bits].forEach((b, k) => { if (b === '1') { const last = bars.at(-1); if (last && last.x + last.w === k + 9) last.w++; else bars.push({ x: k + 9, w: 1 }); } });
  return { bars, width: bits.length + 18, text: d };
}
// QR code: the smallest version that holds the text at the error correction level (L, M, Q, H)
function qr(text, level = 'M') {
  const q = qrcode(0, level);
  q.addData(String(text), 'Byte');
  q.make();
  const n = q.getModuleCount();
  const dark = [];
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) dark.push([c, r]);
  return { modules: n, dark };
}
qrcode.stringToBytes = qrcode.stringToBytesFuncs['UTF-8'];   // QR content as UTF-8 (e-invoices, payment slips)

// the names used in layouts (SAP / Adobe names too) -> bwip-js symbologies
const ALIASES = { code39: 'code39', code3of9: 'code39', code39ext: 'code39ext', code93: 'code93', ean8: 'ean8', upca: 'upca', upce: 'upce',
  itf: 'interleaved2of5', interleaved2of5: 'interleaved2of5', itf14: 'itf14', codabar: 'rationalizedCodabar', gs1128: 'gs1-128', 'gs1-128': 'gs1-128', ean128: 'gs1-128',
  datamatrix: 'datamatrix', gs1datamatrix: 'gs1datamatrix', pdf417: 'pdf417', micropdf417: 'micropdf417', aztec: 'azteccode', azteccode: 'azteccode', maxicode: 'maxicode', isbn: 'isbn', postnet: 'postnet' };
export const BARCODES = ['qr', 'code128', 'ean13', ...Object.keys(ALIASES)];
function viaBwip(bcid, text) {
  let r;
  try { r = bwip.raw({ bcid, text: String(text), includetext: true })[0]; }
  catch (e) { throw new Error(`${bcid}: ${String(e.message || e).replace(/^bwipp\.\w+#\d+:\s*/, '')}`); }
  if (r.pixs) {   // a 2D symbol: rows of modules (pixs is row by row, 1 = dark)
    const dark = [];
    for (let y = 0; y < r.pixy; y++) for (let x = 0; x < r.pixx; x++) if (r.pixs[y * r.pixx + x]) dark.push([x, y]);
    return { kind: 'matrix', modules: r.pixx, rows: r.pixy, dark };
  }
  // linear: bar, space, bar, … widths in modules
  const bars = [];
  let x = 10;
  r.sbs.forEach((w, k) => { if (k % 2 === 0 && w > 0) bars.push({ x, w }); x += w; });
  const txt = (r.txt || []).map(t => t[0]).join('');
  return { kind: 'bars', bars, width: x + 10, ...(txt ? { text: txt } : {}) };
}

export function barcode(type, value, opts = {}) {
  const t = String(type || 'code128').toLowerCase();
  switch (t) {
    case 'code128': return { kind: 'bars', ...code128(value) };
    case 'ean13': return { kind: 'bars', ...ean13(value) };
    case 'qr': case 'qrcode': return { kind: 'matrix', ...qr(value, opts.level || 'M') };
  }
  const bcid = ALIASES[t.replace(/[\s_]/g, '')] || (bwip.symbolList?.some?.(s => s.sym === t) ? t : null) || t;
  try { return viaBwip(bcid, value); } catch (e) {
    if (/unknown|not.*(found|supported)|bcid/i.test(e.message) && !ALIASES[t]) throw new Error(`Unknown barcode type ${type} (${BARCODES.join(', ')})`);
    throw e;
  }
}
