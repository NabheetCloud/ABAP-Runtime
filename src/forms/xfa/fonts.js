// Fonts of XFA templates: a typeface with weight and posture -> a TrueType or OpenType font (.ttf, .otf, a face of a
// .ttc collection) of the system or the app's fonts/ folder (embedded in the PDF, like Adobe Document Services embeds them) or one of the standard PDF fonts with the same metrics. SAP-icons (the
// SAP icon font used in SAP's form templates) comes from the SAPUI5 CDN once and is kept in the user's cache.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { fontFaces, extractFace } from '../ttf.js';

const DIRS = [
  '/System/Library/Fonts/Supplemental', '/System/Library/Fonts', '/Library/Fonts', path.join(os.homedir(), 'Library/Fonts'),
  '/usr/share/fonts/truetype/msttcorefonts', '/usr/share/fonts/truetype/liberation', '/usr/share/fonts/truetype/liberation2',
  '/usr/share/fonts/truetype/dejavu', '/usr/share/fonts/TTF', 'C:\\Windows\\Fonts',
];
// typeface -> file names per style (regular, bold, italic, bold italic); the first one found is used
const FILES = {
  arial: [['Arial.ttf', 'arial.ttf', 'LiberationSans-Regular.ttf'], ['Arial Bold.ttf', 'arialbd.ttf', 'LiberationSans-Bold.ttf'],
    ['Arial Italic.ttf', 'ariali.ttf', 'LiberationSans-Italic.ttf'], ['Arial Bold Italic.ttf', 'arialbi.ttf', 'LiberationSans-BoldItalic.ttf']],
  'times new roman': [['Times New Roman.ttf', 'times.ttf', 'LiberationSerif-Regular.ttf'], ['Times New Roman Bold.ttf', 'timesbd.ttf', 'LiberationSerif-Bold.ttf'],
    ['Times New Roman Italic.ttf', 'timesi.ttf', 'LiberationSerif-Italic.ttf'], ['Times New Roman Bold Italic.ttf', 'timesbi.ttf', 'LiberationSerif-BoldItalic.ttf']],
  'courier new': [['Courier New.ttf', 'cour.ttf', 'LiberationMono-Regular.ttf'], ['Courier New Bold.ttf', 'courbd.ttf', 'LiberationMono-Bold.ttf'],
    ['Courier New Italic.ttf', 'couri.ttf', 'LiberationMono-Italic.ttf'], ['Courier New Bold Italic.ttf', 'courbi.ttf', 'LiberationMono-BoldItalic.ttf']],
  verdana: [['Verdana.ttf', 'verdana.ttf'], ['Verdana Bold.ttf', 'verdanab.ttf'], ['Verdana Italic.ttf', 'verdanai.ttf'], ['Verdana Bold Italic.ttf', 'verdanaz.ttf']],
  tahoma: [['Tahoma.ttf', 'tahoma.ttf'], ['Tahoma Bold.ttf', 'tahomabd.ttf'], ['Tahoma.ttf'], ['Tahoma Bold.ttf']],
  georgia: [['Georgia.ttf', 'georgia.ttf'], ['Georgia Bold.ttf', 'georgiab.ttf'], ['Georgia Italic.ttf', 'georgiai.ttf'], ['Georgia Bold Italic.ttf', 'georgiaz.ttf']],
};
const ALIAS = { helvetica: 'arial', 'myriad pro': 'arial', 'sans-serif': 'arial', times: 'times new roman', 'times-roman': 'times new roman', serif: 'times new roman', courier: 'courier new', monospace: 'courier new' };
const STANDARD = { arial: ['Helvetica', 'Helvetica-Bold', 'Helvetica-Oblique', 'Helvetica-BoldOblique'], 'times new roman': ['Times-Roman', 'Times-Bold', 'Times-Roman', 'Times-Bold'], 'courier new': ['Courier', 'Courier-Bold', 'Courier', 'Courier-Bold'] };
const ICONS_URL = 'https://ui5.sap.com/resources/sap/ui/core/themes/base/fonts/SAP-icons.ttf';
// SAP's 72 font family (SAP Fiori's typeface): WOFF files of @sap-theming/theming-base-content (Apache-2.0)
const FONT72_URL = f => `https://unpkg.com/@sap-theming/theming-base-content@11.36.5/content/Base/baseLib/baseTheme/fonts/${f}-full.woff`;
// typeface -> the 72 files per style (regular, bold, italic, bold italic)
function font72(fam) {
  const f = fam.replace(/\s+/g, ' ');
  if (!/^72(\b|mono)/.test(f)) return null;
  if (/mono/.test(f)) return ['72Mono-Regular', '72Mono-Bold', '72Mono-Regular', '72Mono-Bold'];
  if (/black/.test(f)) return ['72-Black', '72-Black', '72-Black', '72-Black'];
  if (/light/.test(f)) return ['72-Light', '72-Bold', '72-Light', '72-BoldItalic'];
  if (/condensed/.test(f)) return ['72-Condensed', '72-CondensedBold', '72-Condensed', '72-CondensedBold'];
  if (/semibold|medium/.test(f)) return ['72-Semibold', '72-Bold', '72-Semibold', '72-BoldItalic'];
  return ['72-Regular', '72-Bold', '72-Italic', '72-BoldItalic'];   // 72, 72 Brand
}
// a WOFF (1.0) font -> the TrueType font it wraps (tables inflated)
export function woffToTtf(buf) {
  if (buf.toString('latin1', 0, 4) !== 'wOFF') throw new Error('Not a WOFF font');
  const flavor = buf.readUInt32BE(4), n = buf.readUInt16BE(12);
  const tables = [];
  for (let i = 0; i < n; i++) {
    const e = 44 + i * 20;
    const tag = buf.toString('latin1', e, e + 4), off = buf.readUInt32BE(e + 4), comp = buf.readUInt32BE(e + 8), orig = buf.readUInt32BE(e + 12), sum = buf.readUInt32BE(e + 16);
    const raw = buf.subarray(off, off + comp);
    tables.push({ tag, sum, data: comp < orig ? zlib.inflateSync(raw) : Buffer.from(raw) });
  }
  tables.sort((a, b) => (a.tag < b.tag ? -1 : 1));
  const p2 = 2 ** Math.floor(Math.log2(n));
  const head = Buffer.alloc(12 + n * 16);
  head.writeUInt32BE(flavor, 0); head.writeUInt16BE(n, 4); head.writeUInt16BE(p2 * 16, 6); head.writeUInt16BE(Math.log2(p2), 8); head.writeUInt16BE(n * 16 - p2 * 16, 10);
  let off = head.length;
  const parts = [head];
  tables.forEach((t, i) => {
    const e = 12 + i * 16;
    head.write(t.tag, e, 'latin1'); head.writeUInt32BE(t.sum, e + 4); head.writeUInt32BE(off, e + 8); head.writeUInt32BE(t.data.length, e + 12);
    const pad = (4 - (t.data.length % 4)) % 4;
    parts.push(t.data, Buffer.alloc(pad));
    off += t.data.length + pad;
  });
  return Buffer.concat(parts);
}
// a cached font file: downloaded once (WOFF converted), null without network
function cachedFont(file, url, woff) {
  const f = path.join(cacheDir(), file);
  if (fs.existsSync(f)) return f;
  if (found.has(`tried:${file}`) || process.env.RAP_NO_FONT_DOWNLOAD) return null;
  found.set(`tried:${file}`, true);
  try {
    fs.mkdirSync(cacheDir(), { recursive: true });
    // per-process temporary names and a rename: another process never reads a half-written font
    const part = `${f}.${process.pid}.part`;
    execFileSync('curl', ['-sfL', '--max-time', '20', '-o', part, url], { stdio: 'ignore' });
    const b = fs.readFileSync(part);
    fs.writeFileSync(`${part}2`, woff ? woffToTtf(b) : b);
    fs.renameSync(`${part}2`, f);
    fs.rmSync(part, { force: true });
    return f;
  } catch { try { fs.rmSync(`${f}.${process.pid}.part`, { force: true }); fs.rmSync(`${f}.${process.pid}.part2`, { force: true }); } catch {} return fs.existsSync(f) ? f : null; }
}
const cacheDir = () => process.env.RAP_FONT_CACHE || path.join(os.homedir(), '.cache', 'rap-studio', 'fonts');
const found = new Map();

function systemFile(names) {
  for (const n of names) for (const d of DIRS) { const f = path.join(d, n); try { if (fs.statSync(f).isFile()) return f; } catch {} }
  return null;
}
// the SAP icon font: cached, else fetched once (no network: null, the icons are left out with a warning)
function sapIcons() {
  const f = path.join(cacheDir(), 'SAP-icons.ttf');
  if (fs.existsSync(f)) return f;
  if (found.has('sap-icons-tried')) return null;
  found.set('sap-icons-tried', true);
  if (process.env.RAP_NO_FONT_DOWNLOAD) return null;
  try {
    fs.mkdirSync(cacheDir(), { recursive: true });
    execFileSync('curl', ['-sfL', '--max-time', '15', '-o', `${f}.${process.pid}.part`, ICONS_URL], { stdio: 'ignore' });
    fs.renameSync(`${f}.${process.pid}.part`, f);
    return f;
  } catch { try { fs.rmSync(`${f}.${process.pid}.part`, { force: true }); } catch {} return fs.existsSync(f) ? f : null; }
}

// { typeface, weight ('bold'), posture ('italic') } -> { name, file } (embed the file) or { name } (a standard font)
export function resolveFont(typeface = 'Arial', weight = 'normal', posture = 'normal', extraDirs = []) {
  const fam = String(typeface || 'Arial').trim().toLowerCase().replace(/\s+/g, ' ');
  const style = (weight === 'bold' ? 1 : 0) + (posture === 'italic' ? 2 : 0);
  // the app's own fonts first (fonts/ of the app: "72 Brand" -> 72Brand-Regular.ttf, 72 Brand Bold.ttf, …)
  const own = appFont(typeface, style, extraDirs);
  if (own) return own;
  const key = `${fam}|${style}|${(extraDirs || []).join(path.delimiter)}`;
  if (found.has(key)) return found.get(key);
  let r;
  if (/^sap-?icons$/.test(fam)) { const f = sapIcons(); r = f ? { name: 'SAP-icons', file: f } : { name: 'Helvetica', missing: 'SAP-icons' }; }
  else if (font72(fam)) {
    const name = font72(fam)[style];
    const f = local72(name, extraDirs) || cachedFont(`${name}.ttf`, FONT72_URL(name), true);
    r = f ? { name: name.replace(/[^A-Za-z0-9-]/g, ''), file: f } : { name: ['Helvetica', 'Helvetica-Bold', 'Helvetica-Oblique', 'Helvetica-BoldOblique'][style], substitute: `${typeface} (offline: put ${name}.ttf, .otf or ${name}-full.woff into the app's fonts/ folder, or install @sap-theming/theming-base-content)` };
  }
  else {
    const base = FILES[fam] ? fam : ALIAS[fam] || fam;
    const files = FILES[base];
    const file = files && (systemFile(files[style]) || systemFile(files[0]));
    // another typeface installed on the system (its own name): a .ttf / .otf per style, or a face of a .ttc collection
    const other = !files && (systemFile(styleNames(typeface, style)) || systemCollection(typeface, style) || (style ? systemFile(styleNames(typeface, 0)) || systemCollection(typeface, 0) : null));
    const std = (STANDARD[base] || STANDARD.arial)[style];
    r = file ? { name: fontName(file), file } : other ? { name: fontName(other), file: other } : { name: std, ...(STANDARD[base] ? {} : { substitute: typeface }) };
  }
  // a missing 72 is looked for again (the user may add it to the app's fonts/ folder while the studio runs)
  if (r.file || !font72(fam)) found.set(key, r);
  return r;
}

const norm = t => String(t).toLowerCase().replace(/[\s_-]+/g, '');
function appFont(typeface, style, dirs) {
  const want = norm(typeface), suffix = ['(regular|normal|book|roman)?', '(bold|medium|semibold)', '(italic|oblique)', '(bolditalic|boldoblique|mediumitalic)'][style];
  const esc = want.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`^${esc}${suffix}\\.(ttf|otf)$`);
  for (const d of dirs || []) {
    let files = [];
    try { files = fs.readdirSync(d); } catch { continue; }
    const f = files.find(x => re.test(norm(x))) || (style ? files.find(x => new RegExp(`^${esc}(regular)?\\.(ttf|otf)$`).test(norm(x))) : null);
    if (f) return { name: fontName(f), file: path.join(d, f) };
    // a collection of the family: the face of the style
    const c = files.find(x => new RegExp(`^${esc}\\.(ttc|otc)$`).test(norm(x)));
    const face = c && collectionFace(path.join(d, c), style);
    if (face) return { name: fontName(face), file: face };
  }
  return null;
}

const typeface0Of = t => String(t);
const fontName = f => path.basename(f).replace(/\.(ttf|otf|ttc|otc)$/i, '').replace(/\s+/g, '');
// file names of a typeface's style: "Name.ttf", "Name Bold.otf", "Name-Bold.ttf", "NameBold.otf" …
function styleNames(typeface, style) {
  const st = ['', 'Bold', 'Italic', 'Bold Italic'][style], out = [];
  for (const ext of ['ttf', 'otf']) for (const typeface0 of [...new Set([typeface0Of(typeface), String(typeface).replace(/\s+/g, '')])]) {
    const typeface = typeface0;
    if (!style) out.push(`${typeface}.${ext}`, `${typeface}-Regular.${ext}`, `${typeface} Regular.${ext}`);
    else out.push(`${typeface} ${st}.${ext}`, `${typeface}-${st.replace(' ', '')}.${ext}`, `${typeface}${st.replace(' ', '')}.${ext}`);
  }
  return out;
}
// a typeface installed as a collection (Helvetica.ttc, Optima.ttc): the face of the style, as a font file of its own
function systemCollection(typeface, style) {
  const flat = String(typeface).replace(/\s+/g, '');
  const c = systemFile([`${typeface}.ttc`, `${typeface}.otc`, `${flat}.ttc`, `${flat}.otc`]);
  return c ? collectionFace(c, style) : null;
}
const STYLE_RE = [/^(regular|roman|book|normal|medium)$/i, /^bold$/i, /^(italic|oblique)$/i, /^bold ?(italic|oblique)$/i];
function collectionFace(file, style) {
  const key = `ttc:${file}|${style}`;
  if (found.has(key)) return found.get(key);
  let out = null;
  try {
    const buf = fs.readFileSync(file);
    const faces = fontFaces(buf);
    const face = faces.find(f => STYLE_RE[style].test(String(f.style || '').trim())) || (style ? null : faces[0]);
    if (face) {
      const name = `${String(face.postscript || face.full || `${path.basename(file).replace(/\.\w+$/, '')}-${face.index}`).replace(/[^A-Za-z0-9-]/g, '')}.${face.cff ? 'otf' : 'ttf'}`;
      const f = path.join(cacheDir(), 'faces', name);
      if (!fs.existsSync(f)) { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, extractFace(buf, face.index)); }
      out = f;
    }
  } catch { out = null; }
  found.set(key, out);
  return out;
}
// SAP's 72 without network: the app's fonts/ folder (.ttf, .otf or the -full.woff of SAP's theming content) or an
// installed @sap-theming/theming-base-content (its WOFF converted once into the cache)
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
function local72(name, dirs) {
  const theming = p => path.join(p, 'node_modules', '@sap-theming', 'theming-base-content', 'content', 'Base', 'baseLib', 'baseTheme', 'fonts');
  for (const d of [...(dirs || []), theming(ROOT), theming(process.cwd())]) {
    for (const f of [`${name}.ttf`, `${name}.otf`]) { const p = path.join(d, f); if (fs.existsSync(p)) return p; }
    for (const f of [`${name}-full.woff`, `${name}.woff`]) {
      const p = path.join(d, f);
      if (!fs.existsSync(p)) continue;
      const out = path.join(cacheDir(), `${name}.ttf`);
      try { if (!fs.existsSync(out)) { fs.mkdirSync(cacheDir(), { recursive: true }); fs.writeFileSync(out, woffToTtf(fs.readFileSync(p))); } return out; } catch { return null; }
    }
  }
  return null;
}
