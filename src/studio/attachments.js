// Files the user attaches to a chat message (documents, specifications, screenshots, mockups): saved in the app's
// .rap/attachments (not part of the sources), and named in the message to the agent so it reads them. The agent's
// Read tool shows images and PDFs as they are; Word, Excel and PowerPoint files get a text extract next to them
// (<file>.txt), as do OpenDocument texts.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

export const MAX_FILES = 10;
export const MAX_BYTES = 25 * 1024 * 1024;
const KINDS = [
  [/\.(png|jpe?g|gif|webp|bmp)$/i, 'image'], [/\.pdf$/i, 'pdf'], [/\.docx$/i, 'word'], [/\.xlsx$/i, 'excel'], [/\.pptx$/i, 'powerpoint'],
  [/\.odt$/i, 'opendocument'], [/\.(txt|md|csv|tsv|json|xml|html?|abap|cds|sql|js|ts|yaml|yml|log|eml|xdp|asddls|asbdef)$/i, 'text'],
];
export const kindOf = name => KINDS.find(([re]) => re.test(name))?.[1] || 'file';
const LABEL = { image: 'image (screenshot / mockup)', pdf: 'PDF document', word: 'Word document', excel: 'Excel workbook', powerpoint: 'PowerPoint presentation', opendocument: 'OpenDocument text', text: 'text file', file: 'file' };

// the entries of a ZIP archive (Office files): name -> Buffer
export function unzip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('not a ZIP archive');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = new Map();
  for (let k = 0; k < count && buf.readUInt32LE(p) === 0x02014b50; k++) {
    const method = buf.readUInt16LE(p + 10), size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30), commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8');
    p += 46 + nameLen + extraLen + commentLen;
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const data = buf.subarray(start, start + size);
    try { out.set(name, method === 8 ? zlib.inflateRawSync(data) : method === 0 ? data : Buffer.alloc(0)); } catch { /* damaged entry */ }
  }
  return out;
}
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decode = s => s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => (e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENT[e] ?? m));
const strip = s => decode(s.replace(/<[^>]+>/g, ''));
const tidy = s => s.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();

// Word: paragraphs, tabs, tables as | separated cells
function docxText(zip) {
  const xml = zip.get('word/document.xml')?.toString('utf8') || '';
  const t = xml.replace(/<w:tab\/>/g, '\t').replace(/<w:br\/>/g, '\n').replace(/<\/w:p>\s*<\/w:tc>/g, '</w:tc>')
    .replace(/<\/w:tc>\s*<\/w:tr>/g, '</w:tr>').replace(/<\/w:tc>/g, ' | ').replace(/<\/w:p>/g, '\n').replace(/<\/w:tr>/g, '\n');
  return tidy(strip(t));
}
// Excel: every sheet with its name, rows as tab-separated values (shared and inline strings, numbers as stored)
function xlsxText(zip) {
  const shared = [...(zip.get('xl/sharedStrings.xml')?.toString('utf8') || '').matchAll(/<si>([\s\S]*?)<\/si>/g)].map(m => strip(m[1]));
  const wb = zip.get('xl/workbook.xml')?.toString('utf8') || '';
  const rels = zip.get('xl/_rels/workbook.xml.rels')?.toString('utf8') || '';
  const target = id => /Target="([^"]+)"/.exec(new RegExp(`<Relationship[^>]*Id="${id}"[^>]*>`).exec(rels)?.[0] || '')?.[1];
  const sheets = [...wb.matchAll(/<sheet [^>]*name="([^"]*)"[^>]*r:id="([^"]*)"/g)].map(m => ({ name: decode(m[1]), file: `xl/${String(target(m[2]) || '').replace(/^\/?xl\//, '')}` }));
  const col = ref => { let n = 0; for (const c of /^[A-Z]+/.exec(ref)?.[0] || 'A') n = n * 26 + c.charCodeAt(0) - 64; return n - 1; };
  return tidy(sheets.map(sh => {
    const xml = zip.get(sh.file)?.toString('utf8') || '';
    const rows = [...xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)].map(r => {
      const cells = [];
      for (const c of r[1].matchAll(/<c ([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const at = c[1], body = c[2] || '';
        const ref = /r="([A-Z]+)\d+"/.exec(at)?.[1] || 'A', t = /t="(\w+)"/.exec(at)?.[1];
        const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
        cells[col(ref)] = t === 's' ? shared[Number(v)] ?? '' : t === 'inlineStr' ? strip(/<is>([\s\S]*?)<\/is>/.exec(body)?.[1] || '') : decode(v ?? '');
      }
      return Array.from(cells, x => x ?? '').join('\t');
    }).filter(r => r.trim());
    return `## Sheet ${sh.name}\n${rows.join('\n')}`;
  }).join('\n\n'));
}
// PowerPoint: the text of every slide (and its notes), in order
function pptxText(zip) {
  const num = n => Number(/(\d+)\.xml$/.exec(n)?.[1] || 0);
  const slides = [...zip.keys()].filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort((a, b) => num(a) - num(b));
  return tidy(slides.map(n => {
    const t = x => tidy(strip((zip.get(x)?.toString('utf8') || '').replace(/<\/a:p>/g, '\n')));
    const notes = t(`ppt/notesSlides/notesSlide${num(n)}.xml`);
    return `## Slide ${num(n)}\n${t(n)}${notes ? `\n(Notes: ${notes.replace(/\n/g, ' ')})` : ''}`;
  }).join('\n\n'));
}
function odtText(zip) {
  const xml = zip.get('content.xml')?.toString('utf8') || '';
  const t = xml.replace(/<text:tab\/>/g, '\t').replace(/<\/text:p>\s*<\/table:table-cell>/g, '</table:table-cell>')
    .replace(/<\/table:table-cell>\s*<\/table:table-row>/g, '</table:table-row>').replace(/<\/table:table-cell>/g, ' | ')
    .replace(/<\/text:p>|<\/text:h>/g, '\n').replace(/<\/table:table-row>/g, '\n');
  return tidy(strip(t));
}
export function extractText(name, buf) {
  const zip = unzip(buf);
  const k = kindOf(name);
  return k === 'word' ? docxText(zip) : k === 'excel' ? xlsxText(zip) : k === 'powerpoint' ? pptxText(zip) : odtText(zip);
}

// [{ name, type, data (base64) }] -> saved files [{ name, file, url, kind, size, text }]
export function saveAttachments(appDir, appName, list = []) {
  if (!Array.isArray(list) || !list.length) return [];
  if (list.length > MAX_FILES) throw Object.assign(new Error(`At most ${MAX_FILES} files per message`), { status: 400 });
  const dir = path.join(appDir, '.rap', 'attachments');
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  return list.map((a, i) => {
    const buf = Buffer.from(String(a.data || '').replace(/^data:[^,]*,/, ''), 'base64');
    if (!buf.length) throw Object.assign(new Error(`${a.name} is empty`), { status: 400 });
    if (buf.length > MAX_BYTES) throw Object.assign(new Error(`${a.name} is larger than ${MAX_BYTES / 1024 / 1024} MB`), { status: 400 });
    const safe = String(a.name || `file${i + 1}`).replace(/[^\w.\- ]+/g, '_').replace(/\s+/g, '-').slice(-80) || `file${i + 1}`;
    const file = path.join(dir, `${stamp}-${i + 1}-${safe}`);
    fs.writeFileSync(file, buf);
    const kind = kindOf(safe);
    const out = { name: String(a.name || safe), file, url: `/studio/api/apps/${appName}/attachments/${encodeURIComponent(path.basename(file))}`, kind, size: buf.length };
    if (['word', 'excel', 'powerpoint', 'opendocument'].includes(kind)) {
      try { const text = extractText(safe, buf); fs.writeFileSync(`${file}.txt`, text); out.text = `${file}.txt`; }
      catch (e) { out.error = `could not read it (${e.message})`; }
    }
    return out;
  });
}

// what the agent is told about the files
export function attachmentNote(saved) {
  if (!saved.length) return '';
  const lines = saved.map(a => `- ${a.file} — ${a.name}, ${LABEL[a.kind]}${a.text ? `; its text: ${a.text}` : ''}${a.error ? `; ${a.error}` : ''}`);
  return `\n\nThe user attached ${saved.length === 1 ? 'a file' : `${saved.length} files`} to this message. Read ${saved.length === 1 ? 'it' : 'each of them'} with the Read tool before you start and use ${saved.length === 1 ? 'it' : 'them'} together with the message: specifications and documents describe the requirements (fields, rules, processes); screenshots and mockups show what the user wants to see — match their fields, labels, columns and layout; a screenshot of an error shows a problem to fix.\n${lines.join('\n')}`;
}
// the attachments of a chat message, for the chat's history (no paths)
export const attachmentMeta = saved => saved.map(({ name, url, kind, size }) => ({ name, url, kind, size }));
