// Files attached to chat messages (studio): saved in the app, text extracted from Office files, named in the agent's message.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { extractText, saveAttachments, attachmentNote, attachmentMeta, unzip } from '../src/studio/attachments.js';
import { Studio } from '../src/studio/studio.js';

// a ZIP archive (deflated entries) of { name: text }
function zip(entries) {
  const locals = [], centrals = [];
  let offset = 0;
  for (const [name, text] of Object.entries(entries)) {
    const raw = Buffer.from(text, 'utf8'), data = zlib.deflateRawSync(raw), n = Buffer.from(name, 'utf8');
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(8, 8);
    local.writeUInt32LE(data.length, 18); local.writeUInt32LE(raw.length, 22); local.writeUInt16LE(n.length, 26);
    const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(8, 10);
    central.writeUInt32LE(data.length, 20); central.writeUInt32LE(raw.length, 24); central.writeUInt16LE(n.length, 28); central.writeUInt32LE(offset, 42);
    locals.push(local, n, data); centrals.push(central, n);
    offset += 30 + n.length + data.length;
  }
  const cd = Buffer.concat(centrals), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(centrals.length / 2, 8); end.writeUInt16LE(centrals.length / 2, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}
const XLSX = zip({
  'xl/workbook.xml': '<workbook xmlns:r="r"><sheets><sheet name="Employees" sheetId="1" r:id="rId1"/><sheet name="Depts &amp; costs" sheetId="2" r:id="rId2"/></sheets></workbook>',
  'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="/xl/worksheets/sheet2.xml"/></Relationships>',
  'xl/sharedStrings.xml': '<sst><si><t>Name</t></si><si><t>Salary</t></si><si><r><t>Anna </t></r><r><t>Becker</t></r></si></sst>',
  'xl/worksheets/sheet1.xml': '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row><row r="2"><c r="A2" t="s"><v>2</v></c><c r="C2"><v>55000.5</v></c></row></sheetData></worksheet>',
  'xl/worksheets/sheet2.xml': '<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>IT</t></is></c></row></sheetData></worksheet>',
});
const PPTX = zip({
  'ppt/slides/slide2.xml': '<p:sld><a:p><a:r><a:t>Second</a:t></a:r></a:p></p:sld>',
  'ppt/slides/slide1.xml': '<p:sld><a:p><a:r><a:t>Leave requests</a:t></a:r></a:p><a:p><a:r><a:t>Approve &lt;3 days</a:t></a:r></a:p></p:sld>',
  'ppt/notesSlides/notesSlide1.xml': '<p:notes><a:p><a:t>Say hello</a:t></a:p></p:notes>',
});
const DOCX = zip({ 'word/document.xml': '<w:document><w:body><w:p><w:r><w:t>Spec</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>Field</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Type</w:t></w:r></w:p></w:tc></w:tr></w:tbl><w:p><w:r><w:t>A</w:t></w:r><w:tab/><w:r><w:t>B</w:t></w:r></w:p></w:body></w:document>' });

test('Office files: text of Word paragraphs and tables, Excel sheets, PowerPoint slides with notes', () => {
  assert.equal(unzip(XLSX).size, 5);
  assert.equal(extractText('x.xlsx', XLSX), '## Sheet Employees\nName\tSalary\nAnna Becker\t\t55000.5\n\n## Sheet Depts & costs\nIT');
  assert.equal(extractText('x.pptx', PPTX), '## Slide 1\nLeave requests\nApprove <3 days\n(Notes: Say hello)\n\n## Slide 2\nSecond');
  assert.equal(extractText('x.docx', DOCX), 'Spec\nField | Type\nA\tB');
  assert.throws(() => extractText('x.docx', Buffer.from('not a zip')), /not a ZIP/);
});

test('attachments: saved in .rap/attachments, text next to Office files, the note names every file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rap-att-'));
  const png = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');
  const saved = saveAttachments(dir, 'demo', [
    { name: 'screen shot.png', type: 'image/png', data: png.toString('base64') },
    { name: 'spec.xlsx', data: XLSX.toString('base64') },
    { name: '../../evil.txt', data: Buffer.from('hi').toString('base64') },
  ]);
  assert.equal(saved.length, 3);
  assert.ok(saved.every(a => a.file.startsWith(path.join(dir, '.rap', 'attachments'))), 'never outside the folder');
  assert.deepEqual(saved.map(a => a.kind), ['image', 'excel', 'text']);
  assert.equal(fs.readFileSync(saved[1].text, 'utf8').split('\n')[0], '## Sheet Employees');
  const note = attachmentNote(saved);
  assert.match(note, /attached 3 files/);
  for (const a of saved) assert.ok(note.includes(a.file));
  assert.match(note, /screenshots and mockups show what the user wants to see/);
  assert.deepEqual(Object.keys(attachmentMeta(saved)[0]), ['name', 'url', 'kind', 'size']);
  assert.equal(attachmentNote([]), '');
  assert.throws(() => saveAttachments(dir, 'demo', Array(11).fill({ name: 'a.txt', data: 'aGk=' })), /At most 10/);
  assert.throws(() => saveAttachments(dir, 'demo', [{ name: 'a.txt', data: '' }]), /empty/);
});

test('a new app with attachments: the files are saved and shown with the first message', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rap-att-app-'));
  process.env.RAP_CLAUDE_BIN = new URL('./fixtures/fake-claude.mjs', import.meta.url).pathname;
  process.env.FAKE_SPEED = '0.05';
  try {
    const s = new Studio(dir, { port: 4998 });
    const { name } = s.create({ name: 'att-app', prompt: 'Build what the screenshot shows', attachments: [{ name: 'mockup.pptx', data: PPTX.toString('base64') }] });
    const agent = s.agent(name);
    const first = agent.state.items.find(i => i.role === 'user');
    assert.equal(first.text, 'Build what the screenshot shows');
    assert.deepEqual(first.attachments.map(a => [a.name, a.kind]), [['mockup.pptx', 'powerpoint']]);
    const files = fs.readdirSync(path.join(dir, name, '.rap', 'attachments'));
    assert.deepEqual(files.map(f => f.replace(/^\d+-1-/, '')).sort(), ['mockup.pptx', 'mockup.pptx.txt']);
    assert.ok(!s.files(name).some(f => f.includes('attachments')), 'attachments are not app sources');
    await new Promise(resolve => { const t = setInterval(() => { if (!agent.running) { clearInterval(t); resolve(); } }, 50); });
  } finally { delete process.env.RAP_CLAUDE_BIN; }
});
