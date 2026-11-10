// Print forms (SAP Adobe forms): the layout engine (pages, repeating table headers, groups, conditions, formats,
// barcodes, images), the ABAP Cloud APIs (form reader, form data provider, ADS rendering, print queue), the classic
// interface (FP_JOB_OPEN, generated function module, FP_JOB_CLOSE) and the studio's preview.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { Workspace, routeWorkspace } from '../src/server/server.js';
import { renderForm, format, condition, fill } from '../src/forms/engine.js';
import { barcode } from '../src/forms/barcode.js';
import { pdfText } from '../src/classic/client.mjs';
import { execFileSync } from 'node:child_process';
import { evaluate } from '../src/forms/script.js';
import { readTtf } from '../src/forms/ttf.js';
import { readFields } from '../src/forms/pdfread.js';
import { keygen, verifyPdf, signField, createSigningKey } from '../src/forms/sign.js';
import { importXdp } from '../src/forms/xdp.js';
import { convertScript } from '../src/forms/xfascript.js';
import { checkForms } from '../src/forms/check.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rap-forms-'));
fs.cpSync(new URL('./fixtures/forms', import.meta.url).pathname, dir, { recursive: true });
createSigningKey(dir, 'zapprover');
const ws = new Workspace(dir, { lint: false, systemDir: false });
after(() => { ws.close(); fs.rmSync(dir, { recursive: true, force: true }); });
const run = m => ws.app.rt.s(ws.app.rt.cls('zcl_form_demo')[m]({}).rv);

test('formats: dates, amounts and numbers by locale, currency decimals, alpha, case', () => {
  assert.equal(format('20261104', 'date', 'de_DE'), '04.11.2026');
  assert.equal(format('20261104', 'date', 'en_US'), '11/04/2026');
  assert.equal(format(1250.5, 'amount', 'de_DE'), '1.250,50');
  assert.equal(format(1250.5, 'amount', 'en_US'), '1,250.50');
  assert.equal(format('0000000042', 'alpha'), '42');
  assert.equal(format('abc', 'upper'), 'ABC');
  assert.equal(fill('Invoice {id:alpha} for {who}', { id: '0007', who: 'ACME' }), 'Invoice 7 for ACME');
});

test('conditions: comparisons with and, or, not and parentheses', () => {
  const d = { status: 'O', total: 120, vip: 'X' };
  assert.equal(condition("status = 'O'", d), true);
  assert.equal(condition('total > 100 and vip', d), true);
  assert.equal(condition("not (status = 'O' or total < 10)", d), false);
});

test('barcodes: Code 128, EAN-13 with its check digit, QR', () => {
  assert.equal(barcode('code128', 'RAP-2026').kind, 'bars');
  assert.equal(barcode('ean13', '400638133393').text, '4006381333931');
  const q = barcode('qr', 'https://example.com/invoice/42');
  assert.equal(q.kind, 'matrix');
  assert.ok(q.modules >= 21 && q.dark.length > 100);
});

test('barcodes: Code 39, EAN-8, UPC-A, ITF, Codabar, GS1-128, Data Matrix, PDF417, Aztec; drawn in a layout', () => {
  for (const [t, v] of [['code39', 'PO-4500001'], ['code93', 'PO4500001'], ['ean8', '9638507'], ['upca', '03600029145'], ['itf', '12345678'], ['codabar', 'A40156B'], ['gs1-128', '(01)09521234543213']]) {
    const b = barcode(t, v);
    assert.equal(b.kind, 'bars', t);
    assert.ok(b.bars.length > 10, t);
  }
  assert.equal(barcode('ean8', '9638507').text, '96385074');
  const dm = barcode('datamatrix', '4500001001-0010');
  assert.equal(dm.kind, 'matrix');
  assert.equal(dm.modules, dm.rows);
  const pdf417 = barcode('pdf417', 'Delivery 80012345');
  assert.ok(pdf417.modules > pdf417.rows);
  assert.equal(barcode('aztec', '4500001001').kind, 'matrix');
  assert.throws(() => barcode('ean8', 'ABC'), /ean8/i);
  assert.throws(() => barcode('nonsense', '1'), /Unknown barcode type/);
  const r = renderForm({ content: [{ barcode: 'pdf417', value: '{id}', width: 200 }, { barcode: 'datamatrix', value: '{id}', size: 40 }, { barcode: 'code39', value: '{id}' }] }, { id: 'PO4711' }, { design: true });
  assert.deepEqual(r.warnings, []);
  assert.ok(r.layout.pages[0].some(o => o.op === 'matrix'));
  assert.deepEqual(r.layout.boxes.map(b => b.kind), ['barcode', 'barcode', 'barcode']);
});

test('layout: a long table breaks across pages with its header repeated, groups, subtotals, page x of y', () => {
  const items = Array.from({ length: 90 }, (_, i) => ({ grp: i < 45 ? 'Hardware' : 'Services', name: `Item ${i + 1}`, amount: 10 }));
  const form = {
    header: [{ text: 'Report', bold: true }], footer: [{ text: 'Page {page} of {pages}', align: 'center' }],
    content: [
      { text: 'Only for VIPs', if: 'vip' },
      { table: 'items', groupBy: 'grp', groupHeader: '{grp}', subtotal: { amount: 'sum' }, total: { amount: 'sum' },
        columns: [{ title: 'Name', field: 'name' }, { title: 'Amount', field: 'amount', align: 'right', format: 'amount' }] },
    ],
  };
  const r = renderForm(form, { items, vip: '' }, { locale: 'en_US' });
  assert.ok(r.pages >= 2);
  const text = pdfText(r.pdf);
  assert.equal(text.filter(t => t === 'Name').length, r.pages, 'the column titles on every page');
  assert.ok(text.includes(`Page ${r.pages} of ${r.pages}`));
  assert.ok(text.includes('Hardware') && text.includes('Services'));
  assert.ok(text.includes('450.00'), 'a subtotal');
  assert.ok(text.includes('900.00'), 'the total');
  assert.ok(!text.includes('Only for VIPs'), 'the condition hides it');
});

test('layout: text modules by language, watermark, image, address box', () => {
  const png = zlib.deflateSync(Buffer.from([0, 255, 0, 0]));   // 1x1 red pixel, filter byte 0
  const chunk = (t, d) => { const b = Buffer.alloc(8 + d.length + 4); b.writeUInt32BE(d.length); b.write(t, 4, 'latin1'); d.copy(b, 8); return b; };
  const ihdr = Buffer.from([0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0]);
  const img = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', png), chunk('IEND', Buffer.alloc(0))]);
  const form = {
    texts: { greeting: { en: 'Dear customer', de: 'Sehr geehrte Kundin, sehr geehrter Kunde' } },
    watermark: { text: 'DRAFT', if: "status = 'D'" },
    content: [{ image: 'logo.png', width: 40 }, { box: [{ text: '{name}' }], x: 20, y: 45, width: 85 }, { textModule: 'greeting' }],
  };
  const r = renderForm(form, { status: 'D', name: 'ACME Corp' }, { locale: 'de_DE', assets: n => (n === 'logo.png' ? img : null) });
  const text = pdfText(r.pdf);
  assert.ok(text.includes('DRAFT'));
  assert.ok(text.includes('ACME Corp'));
  assert.ok(text.some(t => t.startsWith('Sehr geehrte')));
  assert.match(r.pdf.toString('latin1'), /\/Subtype \/Image/);
});

test('ABAP Cloud: form reader, data provider keys and XML, render_pdf with locale and trace', () => {
  assert.equal(run('cloud'), 'ZFDP_INVOICE/1/X/1/X/X');
});
test('classic: FP_JOB_OPEN, FP_FUNCTION_MODULE_NAME, the generated function module, FP_JOB_CLOSE', () => {
  assert.equal(run('classic'), '/1BCDWB/SM_ZINVOICE/0/1/X');
});
test('interactive form: fillable (docparams-fillable), data extracted with cl_fp, read_fields, signed and verified', () => {
  assert.equal(run('interactive'), 'X/X/Trip to Walldorf/V/error');
});
test('PDF/A-2b: embedded fonts only, sRGB output intent, XMP metadata, no JavaScript; encryption: AES-256 with passwords', () => {
  const form = { title: 'Archive {id}', content: [{ text: 'Invoice **{id}** Ω' }, { input: 'qty', label: 'Qty', value: '2' }, { input: 'net', label: 'Net', calc: 'qty * 10' }, { input: 'ok', type: 'checkbox', label: 'OK', value: 'X' }], watermark: 'COPY' };
  const a = renderForm(form, { id: '4711' }, { pdfa: true });
  const raw = a.pdf.toString('latin1');
  assert.ok(raw.startsWith('%PDF-1.7'));
  assert.ok(!/\/Subtype \/Type1/.test(raw), 'no standard (not embedded) fonts');
  assert.match(raw, /<pdfaid:part>2<\/pdfaid:part>/);
  assert.match(raw, /\/OutputIntents \[<< \/Type \/OutputIntent \/S \/GTS_PDFA1/);
  assert.match(raw, /\/ID \[<[0-9a-f]{32}> <[0-9a-f]{32}>\]/);
  assert.ok(!raw.includes('/JavaScript'));
  assert.ok(a.warnings.some(w => /PDF\/A allows no JavaScript/.test(w)));
  assert.deepEqual(readFields(a.pdf), { qty: '2', net: '20', ok: 'X' });
  assert.ok(pdfText(a.pdf).length >= 0);
  const e = renderForm(form, { id: '4711' }, { security: { userPassword: 'open sesame', ownerPassword: 'boss', permissions: ['print'] } });
  const er = e.pdf.toString('latin1');
  assert.match(er, /\/Encrypt \d+ 0 R/);
  assert.match(er, /\/V 5 \/R 6/);
  // the encrypted strings are hex strings of random bytes (random key, IV, /ID): "4711" can occur in their digits, so
  // the plain text is looked for outside hex strings and streams (it failed ~1.3 % of the runs before)
  const plainPart = er.replace(/stream\r?\n[\s\S]*?\r?\nendstream/g, '').replace(/<[0-9a-fA-F\s]*>/g, '<>');
  assert.ok(!plainPart.includes('(qty)') && !plainPart.includes('4711') && !plainPart.includes('Invoice'), 'strings are encrypted');
  assert.throws(() => readFields(e.pdf), /password/);
  assert.throws(() => readFields(e.pdf, { password: 'wrong' }), /password/);
  assert.equal(readFields(e.pdf, { password: 'open sesame' }).qty, '2');
  assert.equal(readFields(e.pdf, { password: 'boss' }).net, '20');
  // permissions only: opens without a password
  const p = renderForm(form, { id: '1' }, { security: { ownerPassword: 'boss', permissions: ['print', 'fill'] } });
  assert.equal(readFields(p.pdf).qty, '2');
  assert.throws(() => renderForm(form, {}, { security: { permissions: ['fly'] } }), /Unknown permission fly/);
});

test('PDF/A and passwords from ABAP: outputparams-pdftype, zcl_rap_form iv_pdfa / iv_password, read back', () => {
  assert.equal(run('archive'), 'X/X/4/0/X');
});

test('print queue and an unknown form', () => {
  assert.equal(run('queue'), 'X');
  assert.equal(run('short'), 'X/0');
});

test('spool: the forms of one FP job are one output request (queue, copies, title) with the PDFs merged; e_result-spoolids', () => {
  const [n, id] = run('spool').split('/');
  assert.equal(n, '1');
  const row = ws.app.db.prepare('SELECT * FROM rap_output WHERE id = ?').get(Number(id));
  assert.equal(row.title, 'Two invoices');
  assert.equal(row.qname, 'LBL1');
  assert.equal(row.copies, 2);
  assert.equal(row.pages, 2);
  const pdf = Buffer.from(row.pdf);
  assert.equal((pdf.toString('latin1').match(/\/Type \/Page\b/g) || []).length, 2);
  const text = pdfText(pdf).join(' ');   // RAP Studio's own reader (no poppler on the test machines)
  assert.ok(text.includes('First') && text.includes('Second'), text);
});

test('print data: render_4_pq in ZPL for label printers; queue items keep the PDF; PostScript or PDF with a warning', async () => {
  const [ok, item] = run('labels').split('/');
  assert.equal(ok, 'X');
  const row = ws.app.db.prepare('SELECT * FROM rap_output WHERE id = ?').get(Number(item));
  assert.equal(row.format, 'ZPL');
  assert.equal(row.qname, 'LABELS');
  assert.match(Buffer.from(row.pdl).toString(), /^\^XA[\s\S]*\^FO\d+,\d+\^A0N[\s\S]*\^XZ/);
  assert.match(Buffer.from(row.pdf).toString('latin1'), /^%PDF/);
  const { toPdl, mergePdfs, pdfTextRuns } = await import('../src/classic/printq.mjs');
  const pdf = renderForm({ content: [{ text: 'Label 4711' }] }, {}).pdf;
  const runs = pdfTextRuns(pdf)[0].runs;
  assert.ok(runs.some(r => r.text.includes('Label 4711') && r.x > 0 && r.y > 0), JSON.stringify(runs));
  const ps = toPdl(pdf, 'PS');
  if (ps.format === 'PS') assert.match(ps.data.toString('latin1'), /^%!PS/);
  else assert.match(ps.warning, /pdftops|Ghostscript/);
  assert.throws(() => mergePdfs([pdf, Buffer.from('%PDF-1.4\n1 0 obj << /Type /ObjStm >> stream\nx\nendstream endobj\ntrailer << /Root 1 0 R >>')]), /object streams/);
});

// the studio's routes: the preview of the editor's text and the records of the form's data provider
const call = (method, url, body) => {
  let status, headers = {}, out = Buffer.alloc(0);
  const res = { headersSent: false, writeHead(s, h) { status = s; headers = h || {}; }, end(b) { if (b) out = Buffer.from(b); } };
  routeWorkspace(ws, { method, url, headers: {} }, res, body ? JSON.stringify(body) : '', url.split('?')[0], '');
  return { status, headers, body: out };
};
test('studio: records of the data provider and the preview with a record, the sample data or a broken layout', () => {
  const rec = JSON.parse(call('GET', '/api/forms/records?name=zinvoice').body);
  assert.equal(rec.entity, 'Invoice');
  const r42 = rec.records.find(r => r.keys.INVOICEID === '0000000042');
  assert.ok(r42);
  let r = call('POST', '/api/forms/preview', { name: 'zinvoice', keys: r42.keys, locale: 'de_DE' });
  assert.equal(r.status, 200);
  assert.equal(r.headers['Content-Type'], 'application/pdf');
  assert.ok(pdfText(r.body).includes('Mouse'));
  const text = fs.readFileSync(path.join(dir, 'src/zinvoice.form.json'), 'utf8').replace('"Item"', '"Article"');
  r = call('POST', '/api/forms/preview', { name: 'zinvoice', text });
  assert.ok(pdfText(r.body).includes('Article'), 'the unsaved text of the editor');
  assert.ok(pdfText(r.body).includes('Sample'), 'the sample data');
  r = call('POST', '/api/forms/preview', { name: 'zinvoice', text: '{ "content": [' });
  assert.equal(r.status, 400);
});

// ---- calculations, fonts, fillable fields, signatures, XDP import, checks, command line

test('expressions: arithmetic, tables, functions, if-then-else, words', () => {
  const d = { net: 100, status: 'O', flag: '', _item: [{ amount: 10 }, { amount: 5.5 }], h: { c: 'EUR' }, d: '20261104' };
  assert.equal(evaluate('net * 1.19', d), 119);
  assert.equal(evaluate('0.1 + 0.2', d), 0.3);
  assert.equal(evaluate('Sum(_item.amount)', d), 15.5);
  assert.equal(evaluate('Count(_item[*].amount)', d), 2);
  assert.equal(evaluate("if net > 50 then 'big' elseif net > 10 then 'mid' else 'small' endif", d), 'big');
  assert.equal(evaluate("status = 'O' and not flag", d), true);
  assert.equal(evaluate('h.c & "-" & Upper("x")', d), 'EUR-X');
  assert.equal(evaluate('{h-c}', d), 'EUR');
  assert.equal(evaluate('AddDays(d, 30)', d), '20261204');
  assert.equal(evaluate('AmountInWords(1250.5, "eur")', d), 'One Thousand Two Hundred Fifty EUR and 50/100');
  assert.throws(() => evaluate('net +', d), /Incomplete/);
  assert.throws(() => evaluate('Nope(1)', d), /Unknown function/);
});

test('layout: calculated columns feed totals and variables; long cells wrap; warnings name unknown fields', () => {
  const form = {
    variables: { net: 'Sum(_item.net)', gross: 'Round(net * 1.19, 2)' },
    content: [
      { table: '_item', columns: [{ title: 'Text', field: 'text', width: 2 }, { title: 'Net', field: 'net', calc: 'qty * price', format: 'amount', width: 1 }], total: { net: 'sum' }, totalLabel: 'Net total' },
      { text: 'Gross {=gross:amount} {nosuch}' },
    ],
  };
  const long = 'word '.repeat(40).trim();
  const r = renderForm(form, { _item: [{ text: long, qty: 2, price: 10 }, { text: 'b', qty: 1, price: 5.5 }] }, { locale: 'en_US' });
  const lines = r.text[0];
  assert.ok(lines.includes('Gross 30.35'), lines.join('|'));
  assert.ok(lines.some(l => l.startsWith('Net total') && l.endsWith('25.50')), 'the total spans the label columns');
  assert.ok(lines.filter(l => /^word/.test(l)).length > 1, 'the long text wraps');
  assert.deepEqual(r.warnings, ['Unknown field {nosuch}']);
});

// a minimal TrueType font: .notdef and one square glyph for 'A' and 'Ж'
function tinyTtf() {
  const t = {};
  const u16 = (...v) => { const b = Buffer.alloc(v.length * 2); v.forEach((x, i) => b.writeUInt16BE(x & 0xffff, i * 2)); return b; };
  t.head = Buffer.alloc(54); t.head.writeUInt32BE(0x10000, 0); t.head.writeUInt32BE(0x5f0f3cf5, 12); t.head.writeUInt16BE(1000, 18); t.head.writeInt16BE(800, 40); t.head.writeInt16BE(800, 42); t.head.writeInt16BE(1, 50);
  t.hhea = Buffer.alloc(36); t.hhea.writeUInt32BE(0x10000, 0); t.hhea.writeInt16BE(800, 4); t.hhea.writeInt16BE(-200, 6); t.hhea.writeUInt16BE(2, 34);
  t.maxp = Buffer.alloc(6); t.maxp.writeUInt32BE(0x5000, 0); t.maxp.writeUInt16BE(2, 4);
  t.hmtx = u16(500, 0, 700, 50);
  const square = Buffer.concat([u16(1, 50, 0, 650, 700, 3, 0), Buffer.from([1, 1, 1, 1]), u16(50, 600, 0, 65536 - 600), u16(0, 700, 0, 65536 - 700)]);
  t.glyf = Buffer.concat([square, Buffer.alloc((4 - square.length % 4) % 4)]);
  t.loca = Buffer.alloc(12); t.loca.writeUInt32BE(0, 0); t.loca.writeUInt32BE(0, 4); t.loca.writeUInt32BE(t.glyf.length, 8);
  // cmap format 4: 'A' -> 1, 'Ж' -> 1
  const seg = [[0x41, 0x41], [0x416, 0x416], [0xffff, 0xffff]];
  const f4 = Buffer.concat([u16(4, 16 + seg.length * 8, 0, seg.length * 2, 4, 1, 2), u16(...seg.map(s => s[1])), u16(0), u16(...seg.map(s => s[0])), u16(1 - 0x41, 1 - 0x416, 1), u16(0, 0, 0)]);
  t.cmap = Buffer.concat([u16(0, 1, 3, 1), Buffer.from([0, 0, 0, 12]), f4]);
  const tags = Object.keys(t).sort();
  const dir = Buffer.alloc(12 + tags.length * 16); dir.writeUInt32BE(0x10000, 0); dir.writeUInt16BE(tags.length, 4);
  let off = dir.length; const body = [];
  tags.forEach((tag, i) => { const d = t[tag], pad = (4 - d.length % 4) % 4; dir.write(tag, 12 + i * 16, 'latin1'); dir.writeUInt32BE(off, 20 + i * 16); dir.writeUInt32BE(d.length, 24 + i * 16); body.push(d, Buffer.alloc(pad)); off += d.length + pad; });
  return Buffer.concat([dir, ...body]);
}

test('fonts: an embedded TrueType font (subset, Identity-H, ToUnicode) shows characters beyond WinAnsi', () => {
  const ttf = tinyTtf();
  const t = readTtf(ttf);
  assert.equal(t.glyph(0x416), 1);
  assert.equal(t.width(1), 700);
  let r = renderForm({ content: [{ text: 'AЖ' }] }, {});
  assert.match(r.warnings[0], /cannot show Ж/);
  r = renderForm({ fonts: { tiny: 'tiny.ttf' }, font: 'tiny', content: [{ text: 'AЖ' }] }, {}, { assets: n => (n === 'tiny.ttf' ? ttf : null) });
  assert.deepEqual(r.warnings, []);
  const s = r.pdf.toString('latin1');
  assert.match(s, /\/Subtype \/Type0/);
  assert.match(s, /\/FontFile2/);
  assert.match(s, /\/ToUnicode/);
  r = renderForm({ fonts: { tiny: 'missing.ttf' }, content: [{ text: 'x' }] }, {}, { assets: () => null });
  assert.match(r.warnings[0], /Font missing\.ttf not found/);
});

test('fillable fields: text, multi-line, check box, drop-down; values read back; printed when not fillable', () => {
  const form = { content: [
    { input: 'name', label: 'Name', value: '{name}' },
    { input: 'remark', type: 'multiline', value: 'Ünïcödé\nsecond line' },
    { input: 'ok', type: 'checkbox', label: 'OK', value: 'X' },
    { input: 'ship', type: 'dropdown', options: ['Standard', 'Express'], value: 'Express' },
    { repeat: 'rows', items: [{ input: 'qty_{index}', value: '{qty}' }] },
  ] };
  const data = { name: 'Alice', rows: [{ qty: 1 }, { qty: 2 }] };
  const r = renderForm(form, data);
  assert.deepEqual(r.fields.map(f => f.name), ['name', 'remark', 'ok', 'ship', 'qty_1', 'qty_2']);
  assert.deepEqual(readFields(r.pdf), { name: 'Alice', remark: 'Ünïcödé\nsecond line', ok: 'X', ship: 'Express', qty_1: '1', qty_2: '2' });
  const flat = renderForm(form, data, { fillable: false });
  assert.deepEqual(flat.fields, []);
  assert.ok(flat.text[0].includes('Alice'));
  assert.match(renderForm({ content: [{ input: 'a' }, { input: 'a' }] }, {}).warnings[0], /exists twice/);
});

test('signatures: signed when rendered, signed later (incremental update), tampering detected', () => {
  const k = keygen('TESTER');
  const form = { content: [{ text: 'Contract' }, { input: 'sig', type: 'signature', label: 'Signature' }] };
  const r = renderForm(form, {}, { signature: { ...k, field: 'sig', reason: 'Approved' } });
  assert.deepEqual(verifyPdf(r.pdf).map(v => [v.signer, v.reason, v.valid, v.covers]), [['TESTER', 'Approved', true, true]]);
  const bad = Buffer.from(r.pdf); bad[300] ^= 1;
  assert.equal(verifyPdf(bad)[0].valid, false);
  const later = signField(renderForm(form, {}).pdf, { ...k, field: 'sig', reason: 'Later' });
  assert.equal(verifyPdf(later)[0].valid, true);
  assert.equal(readFields(later).sig, 'signed');
  assert.throws(() => signField(later, { ...k, field: 'sig' }), /signed already/);
  assert.throws(() => renderForm({ content: [] }, {}, { signature: k }), /no signature field/);
});

test('XDP import: master page, bound fields, table with repeating row, FormCalc total, barcode, inputs', () => {
  const xdp = fs.readFileSync(new URL('./fixtures/xdp/zinvoice_adobe.xdp', import.meta.url), 'utf8');
  const { form, warnings } = importXdp(xdp, { name: 'zinvoice_adobe' });
  assert.deepEqual(form.page.size, [595.28, 841.89]);
  assert.equal(Math.round(form.page.margin.top), 128);
  const table = form.content.find(i => i.table);
  assert.equal(table.table, 'items');
  assert.deepEqual(table.columns.map(c => [c.title, c.field, c.format]), [['Pos', 'posnr', undefined], ['Material', 'arktx', undefined], ['Quantity', 'fkimg', 'integer'], ['Net value', 'netwr', 'amount']]);
  assert.deepEqual(form.content.find(i => i.fields?.[0][0] === 'Total').fields[0][1], '{= Sum(items.netwr) :amount}');
  assert.ok(form.content.some(i => i.barcode === 'qr'));
  assert.ok(form.content.some(i => i.input === 'sign' && i.type === 'signature'));
  assert.ok(!warnings.some(w => /not converted/.test(w)), warnings.join('\n'));
  const r = renderForm(form, { header: { vbeln: '90000042', name1: 'Muster AG', stras: 'Hauptstr. 5', fkdat: '20261104' }, items: [{ posnr: 10, arktx: 'Laptop', fkimg: 2, netwr: 1999 }, { posnr: 20, arktx: 'Dock', fkimg: 1, netwr: 149.5 }] }, { locale: 'de_DE' });
  assert.ok(r.text[0].includes('Total 2.148,50'), r.text[0].join('|'));
  assert.ok(r.text[0].includes('Invoice 90000042'));
});

test('Adobe scripts: JavaScript and FormCalc calculations, loops over rows, presence, other objects', () => {
  const ref = p => p.toLowerCase().replace(/^items\.row1(\[\*\])?\./, 'items.');
  const c = (src, self, lang = 'js') => convertScript(src, { self, ref, lang });
  assert.equal(c('this.rawValue = Quantity.rawValue * Price.rawValue;', 'Net').value, 'quantity * price');
  assert.equal(c('var t = 0; for (var i = 0; i < Items.Row1.all.length; i++) { t += Items.Row1.all.item(i).Amount.rawValue; } this.rawValue = t;', 'Total').value, 'Sum(items.amount)');
  assert.equal(c('var t = 0; for (var i = 0; i < n; i++) { if (xfa.resolveNode("Items.Row1[" + i + "].Status").rawValue == "X") t += xfa.resolveNode("Items.Row1[" + i + "].Amount").rawValue; } this.rawValue = t;', 'Total').value, "Sum(If(items.status = 'X', items.amount, 0))");
  assert.equal(c('if (this.rawValue == null || this.rawValue == "") { this.presence = "hidden"; } else { this.presence = "visible"; }', 'Remark').visible, 'HasValue(remark)');
  assert.equal(c('this.presence = (Status.rawValue === "O" && Net.rawValue > 1000) ? "visible" : "hidden";', 'A').visible, "(status = 'O') and (net > 1000)");
  assert.deepEqual(c('if (Customer.rawValue.length > 0) Banner.presence = "hidden"; else Banner.presence = "visible";', 'x').effects, [{ target: 'Banner', visible: 'not (Len(customer) > 0)' }]);
  assert.equal(c('this.rawValue = Math.round(Net.rawValue * 0.19 * 100) / 100;', 'Tax').value, 'Round((net * 0.19) * 100, 0) / 100');
  assert.equal(c('this.rawValue = FirstName.rawValue + " " + LastName.rawValue.toUpperCase();', 'N').value, "(firstname & ' ') & Upper(lastname)");
  assert.deepEqual(c('xfa.host.messageBox("hi"); this.rawValue = 1', 'x').notes.length, 1);
  assert.equal(c('Sum(Items.Row1[*].Amount) * 1.19', 'G', 'formcalc').value, 'Sum(items.amount) * 1.19');
  assert.equal(c('if ($.rawValue == "") then\n $.presence = "hidden" ; empty\nendif', 'Remark', 'formcalc').visible, 'HasValue(remark)');
  assert.equal(c('var x = Net * 0.19\nRound(x, 2)', 'Tax', 'formcalc').value, 'Round(net * 0.19, 2)');
  assert.equal(c('if (A > 0 & B > 0) then A * B else 0 endif', 'P', 'formcalc').value, 'if (a > 0) and (b > 0) then a * b else 0 endif');
  assert.throws(() => c('while (true) {}', 'x'), /while/);
  // the converted expressions run: rows, conditions
  assert.equal(evaluate("Sum(If(items.status = 'X', items.amount, 0))", { items: [{ status: 'X', amount: 5 }, { status: '', amount: 7 }] }), 5);
  assert.equal(evaluate('Sum(items.q * items.p)', { items: [{ q: 2, p: 3 }, { q: 1, p: 10 }] }), 16);
});

test('dynamic XFA: flowed rows, first page master page, optional and repeating subforms, breaks, presence, field calculations', () => {
  const xdp = fs.readFileSync(new URL('./fixtures/xdp/zorder_dynamic.xdp', import.meta.url), 'utf8');
  const { form, warnings } = importXdp(xdp, { name: 'zorder_dynamic' });
  assert.ok(form.firstHeader && form.header && form.footer);
  assert.ok(warnings.includes('Script object utils (functions) not converted'));
  const big = form.content.find(i => i.text === 'Large order: approval needed');
  assert.equal(big.if, '(Sum(items.qty * items.price)) > 1000');
  assert.equal(form.content.find(i => i.input === 'copy').calc, 'check');
  assert.ok(!JSON.stringify(form).includes('Screen only'), 'relevant="-print" is not printed');
  const d = { orderno: '4711', customer: 'Muster AG', note: '', items: Array.from({ length: 80 }, (_, k) => ({ matnr: `M${k}`, qty: 1, price: 10 + k })) };
  const big40 = renderForm(form, d);
  assert.equal(big40.pages, 3);
  assert.equal(big40.text[0][0], 'ACME Order');
  assert.equal(big40.text[1][0], 'ACME Order (continued)');
  assert.ok(big40.text[1].includes('M79 1 89 89'), 'rows continue on page 2');
  assert.ok(big40.text[2].includes('Total 3,960.00'), big40.text[2].join('|'));
  assert.ok(big40.text[2].includes('Large order: approval needed'));
  const small = renderForm(form, { ...d, note: 'Rush', discount: { rate: 5 }, items: d.items.slice(0, 2) });
  assert.equal(small.pages, 2);
  assert.ok(small.text[0].includes('Rush') && small.text[0].includes('Discount % 5'));
  assert.ok(!small.text[1].includes('Large order: approval needed'));
  assert.deepEqual(renderForm(form, { ...d, items: [] }).text[0].filter(l => /Rush|Discount/.test(l)), []);
});

test('fillable fields with a calculation: the value when rendered, Acrobat JavaScript to recalculate', () => {
  const f = { content: [{ input: 'qty', label: 'Qty', value: '{q}' }, { input: 'price', label: 'Price', value: '12.5' }, { input: 'net', label: 'Net', calc: 'Round(qty * price * (1 + tax), 2)' }] };
  const r = renderForm(f, { q: 2, tax: 0.19 });
  assert.deepEqual(r.warnings, []);
  assert.deepEqual(readFields(r.pdf), { qty: '2', price: '12.5', net: '29.75' });
  const raw = r.pdf.toString('latin1');
  assert.match(raw, /\/CO \[\d+ 0 R\]/);
  const js = raw.match(/\/JS \((.*?)\) >>/s)[1].replace(/\\([()\\])/g, '$1');
  const vals = { qty: '3', price: '10' };
  const event = { target: { doc: { getField: n => ({ value: vals[n] }) } } };
  new Function('event', js)(event);
  assert.equal(event.value, 35.7);
});

test('checks: invalid JSON, unknown data provider, unknown fields and items; part of the activation', () => {
  const d2 = fs.mkdtempSync(path.join(os.tmpdir(), 'rap-forms-check-'));
  try {
    fs.cpSync(dir, d2, { recursive: true });
    fs.writeFileSync(path.join(d2, 'src/zbroken.form.json'), '{ "content": [\n  { "text": "x" },\n  oops ] }');
    fs.writeFileSync(path.join(d2, 'src/zwrong.form.json'), JSON.stringify({ dataProvider: 'ZNOPE', content: [{ text: '{customer}' }, { tabel: 'x' }] }, null, 1));
    const ws2 = new Workspace(d2, { lint: false, systemDir: false, dbFile: ':memory:' });
    try {
      const f = checkForms(d2, ws2.app.model);
      assert.ok(f.some(x => x.file === 'src/zbroken.form.json' && x.severity === 'error' && x.line === 3), JSON.stringify(f));
      assert.ok(f.some(x => x.file === 'src/zwrong.form.json' && /ZNOPE not found/.test(x.message)));
      assert.ok(f.some(x => /Unknown item/.test(x.message)));
      assert.ok(f.some(x => /Unknown field \{customer\}/.test(x.message)));
      assert.ok(!f.some(x => x.file === 'src/zinvoice.form.json'), 'the invoice layout is clean');
      assert.ok(ws2.app.diagnostics.errors.some(e => e.file === 'src/zbroken.form.json'), 'the activation reports it');
    } finally { ws2.close(); }
  } finally { fs.rmSync(d2, { recursive: true, force: true }); }
});

test('command line: rap form with a data provider record, check, outputs', () => {
  const rap = new URL('../bin/rap.js', import.meta.url).pathname;
  // (each command is a process of its own: on the app's database file, also when the suite runs on PostgreSQL)
  const env = { ...process.env, RAP_PORT: '1' };
  delete env.RAP_DB;
  const sh = (...a) => execFileSync(process.execPath, [rap, ...a], { cwd: dir, encoding: 'utf8', env });
  const out = sh('form', 'zinvoice', 'INVOICEID=0000000042', '--locale', 'de_DE', '--print', '--title', 'CLI test');
  assert.match(out, /--- page 1/);
  assert.match(out, /Mouse 2 25,50 EUR/);
  assert.match(out, /Output request \d+/);
  assert.match(sh('form', 'check'), /layout\(s\) OK/);
  assert.match(sh('outputs'), /CLI test/);
});

test('reference app examples/forms: activates without findings, renders and runs its output class', () => {
  const d3 = fs.mkdtempSync(path.join(os.tmpdir(), 'rap-forms-example-'));
  try {
    fs.cpSync(new URL('../examples/forms', import.meta.url).pathname, d3, { recursive: true });
    const ws3 = new Workspace(d3, { systemDir: false, dbFile: ':memory:' });
    try {
      assert.deepEqual([...ws3.app.diagnostics.errors, ...ws3.app.diagnostics.warnings].map(e => `${e.file}:${e.line} ${e.message}`), []);
      const r = ws3.runClass('zcl_billing_output');
      assert.equal(r.ok, true, r.error);
      assert.match(r.output, /Invoice 90000001 \(ABAP Cloud\): 1 page/);
      assert.match(r.output, /received_by = K\. Schmidt/);
      assert.match(r.output, /Not signed: Signing key ZBILLING not found/);
      const inv = ws3.app.rt.formRead('ZFDP_BILLINGDOC', [{ name: 'BILLINGDOC', value: '0090000001' }]);
      const text = renderForm(JSON.parse(fs.readFileSync(path.join(d3, 'src/zbilling_doc.form.json'), 'utf8')), { sy: { datum: '20261104' }, ...inv }).text[0];
      assert.ok(text.includes('Invoice 90000001'));
      assert.ok(text.some(l => /^Total 6\.404,22 EUR$/.test(l)), text.join('|'));
    } finally { ws3.close(); }
  } finally { fs.rmSync(d3, { recursive: true, force: true }); }
});
