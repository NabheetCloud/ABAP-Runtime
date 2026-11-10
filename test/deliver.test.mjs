// rap deliver: technical specification, QA test report and ATC report of an app, from the agent's description
// (.rap/delivery.json) and the sources; the ATC quick fixes are applied and the test cases run on the app.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { deliver, latestDelivery } from '../src/deliver/deliver.js';
import { Docx, zip, imageSize } from '../src/deliver/docx.js';
import { classicAvailable } from '../src/classic/build.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rap-deliver-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

// the text of a part in a ZIP archive (deflated entries, as zip( ) writes them)
function unzip(buf, name) {
  for (let i = 0; i < buf.length - 30;) {
    if (buf.readUInt32LE(i) !== 0x04034b50) break;
    const size = buf.readUInt32LE(i + 18), len = buf.readUInt16LE(i + 26), extra = buf.readUInt16LE(i + 28);
    const n = buf.toString('utf8', i + 30, i + 30 + len), start = i + 30 + len + extra;
    if (n === name) return zlib.inflateRawSync(buf.subarray(start, start + size)).toString('utf8');
    i = start + size;
  }
  return null;
}

test('the Word writer: a valid package with headings, tables, code and images', () => {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAADCAYAAAC56t6BAAAAEklEQVR4nGP4z8DwHwYYGBgAADnRBvyh0FfHAAAAAElFTkSuQmCC', 'base64');
  assert.deepEqual(imageSize(png), { type: 'png', w: 2, h: 3 });
  const d = new Docx({ header: 'H', footer: 'F' }).title('Technical Specification', 'Sub').heading('1. Purpose').para('a **b** <c>')
    .bullets(['x']).code('REPORT z.').table(['ID', 'Status'], [['FT-01', 'Pass']], { status: 1 }).image(png, 'Figure 1');
  const buf = d.toBuffer();
  const doc = unzip(buf, 'word/document.xml');
  assert.match(doc, /Technical Specification/);
  assert.match(doc, /<w:b\/>.*?b<\/w:t>/);
  assert.match(doc, /a <\/w:t>.*&lt;c&gt;/);
  assert.match(doc, /w:fill="D9F2E1"/);                     // the Pass cell is green
  assert.match(doc, /r:embed="rIdImg1"/);
  assert.match(unzip(buf, 'word/_rels/document.xml.rels'), /media\/image1\.png/);
  assert.ok(unzip(buf, '[Content_Types].xml').includes('wordprocessingml.document.main+xml'));
  assert.equal(zip([['a.txt', 'x']]).readUInt32LE(0), 0x04034b50);
});

const skip = !classicAvailable() ? 'classic engine not installed' : /^pglite|^postgres/.test(process.env.RAP_DB || '') ? 'the classic engine uses the SQLite database' : false;
test('rap deliver: quick fixes, test cases on the classic engine, the three documents and a manifest', { skip, timeout: 300000 }, async () => {
  process.env.RAP_PORT = '9';   // no studio: the engine is started for the folder
  const app = path.join(tmp, 'zdeliv-app');
  fs.mkdirSync(path.join(app, 'src'), { recursive: true });
  fs.mkdirSync(path.join(app, '.rap'), { recursive: true });
  fs.writeFileSync(path.join(app, 'src', 'zdeliv.prog.abap'), `REPORT zdeliv.
PARAMETERS p_name TYPE c LENGTH 20 OBLIGATORY.

START-OF-SELECTION.
  IF NOT p_name IS INITIAL.
    WRITE / |Hello { p_name }|.
  ENDIF.
`);
  fs.writeFileSync(path.join(app, 'src', 'zdeliv.prog.xml'), `<?xml version="1.0" encoding="utf-8"?>\n<abapGit version="v1.0.0" serializer="LCL_OBJECT_PROG" serializer_version="v1.0.0">\n <asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0">\n  <asx:values>\n   <PROGDIR><NAME>ZDELIV</NAME><SUBC>1</SUBC></PROGDIR>\n   <TPOOL>\n    <item><ID>R</ID><ENTRY>Greeting report</ENTRY><LENGTH>15</LENGTH></item>\n    <item><ID>S</ID><KEY>P_NAME</KEY><ENTRY>D       Name</ENTRY><LENGTH>12</LENGTH></item>\n   </TPOOL>\n  </asx:values>\n </asx:abap>\n</abapGit>\n`);
  fs.writeFileSync(path.join(app, '.rap', 'delivery.json'), JSON.stringify({
    title: 'Greeting report ZDELIV', topic: 'greeting', request: 'A report that greets', summary: 'Greets the name entered.',
    design: [{ heading: 'Output', text: 'One list line.' }], limitations: ['Only one name'],
    tests: [{ id: 'FT-01', title: 'Greets Anna', run: 'program ZDELIV P_NAME=Anna', expect: 'Hello Anna' },
            { id: 'FT-02', title: 'Wrong greeting is noticed', run: 'program ZDELIV P_NAME=Bob', expect: 'Hello Anna' },
            { id: 'FT-03', title: 'Unknown kind', run: 'teleport now' }] }));
  const lines = [];
  const m = await deliver(app, { pdf: false, shots: false, log: l => lines.push(l) });
  assert.equal(m.folder, path.join('docs', `${new Date().toISOString().slice(0, 10)}-greeting`));
  assert.deepEqual(m.files, ['ATC_Check_Report.docx', 'QA_Test_Report.docx', 'Technical_Specification.docx']);
  assert.deepEqual({ ...m.tests, screenshots: 0 }, { total: 3, passed: 1, failed: 1, skipped: 1, screenshots: 0 });
  assert.deepEqual(latestDelivery(app).created, m.created);
  // the quick fix (IS NOT instead of NOT ... IS) is applied to the source
  assert.ok(m.atc.fixed > 0, JSON.stringify(m.atc));
  assert.match(fs.readFileSync(path.join(app, 'src', 'zdeliv.prog.abap'), 'utf8'), /IF p_name IS NOT INITIAL\./);
  const read = n => unzip(fs.readFileSync(path.join(app, m.folder, n)), 'word/document.xml').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  const spec = read('Technical_Specification.docx');
  assert.match(spec, /Greets the name entered/);
  assert.match(spec, /Selection screen of ZDELIV/);
  assert.match(spec, /P_NAME Parameter c LENGTH 20 Name yes/);
  assert.match(spec, /Only one name/);
  const qa = read('QA_Test_Report.docx');
  assert.match(qa, /FT-01 Greets Anna .* Pass/);
  assert.match(qa, /FT-02 .* Fail/);
  assert.match(qa, /rap program ZDELIV P_NAME=Anna/);
  const atc = read('ATC_Check_Report.docx');
  assert.match(atc, /Fixed automatically .*prefer_is_not 1/);
  assert.match(atc, /No findings/);
});
