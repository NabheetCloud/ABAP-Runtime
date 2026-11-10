// Adobe XDP layouts rendered natively (src/forms/xfa): SAP's sample templates with SAP-format data, picture clauses,
// SVG, the form data provider's XML and schema, the ABAP APIs end to end (examples/adobe-forms: SAP's cinema sample)
// and the starter layout generated from a data provider.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { renderXdp } from '../src/forms/xfa/render.js';
import { formatPicture } from '../src/forms/xfa/picture.js';
import { svgImage } from '../src/forms/xfa/svg.js';
import { generateXdp } from '../src/forms/xfa/generate.js';
import { Workspace } from '../src/server/server.js';

process.env.RAP_NO_FONT_DOWNLOAD = '1';   // no network in tests (the SAP-icons glyphs are left out)
const FX = new URL('./fixtures/xdp/', import.meta.url).pathname;
const read = f => fs.readFileSync(path.join(FX, f), 'utf8');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rap-xfa-'));
const open = [];
after(() => { for (const w of open) w.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

test('picture clauses: dates, times, date times, numbers, text, predefined styles', () => {
  assert.equal(formatPicture('2024-11-01', 'date{EEEE, D. MMM, YYYY}', 'en_US', 'date'), 'Friday, 1. Nov, 2024');
  assert.equal(formatPicture('20241101', 'date{DD.MM.YYYY}', 'de_DE', 'date'), '01.11.2024');
  assert.equal(formatPicture('2024-11-01', 'date{EEEE, D. MMMM YYYY}', 'de_DE', 'date'), 'Freitag, 1. November 2024');
  assert.equal(formatPicture('13:30:00', 'time{HH:MM}', 'en_US', 'time'), '13:30');
  assert.equal(formatPicture('133000', 'time{h:MM A}', 'en_US', 'time'), '1:30 PM');
  assert.equal(formatPicture('2026-07-18T18:00:00', 'datetime.long{}', 'en_US'), 'July 18, 2026 at 6:00:00 PM');
  assert.equal(formatPicture('1234.5', 'num{z,zzz,zz9.99}', 'en_US', 'decimal'), '1,234.50');
  assert.equal(formatPicture('1234.5', 'num{z,zzz,zz9.99}', 'de_DE', 'decimal'), '1.234,50');
  assert.equal(formatPicture('-12', 'num{(zz9)}', 'en_US'), '(12)');
  assert.equal(formatPicture('4711', 'text{999-9}', 'en_US'), '471-1');
  assert.equal(formatPicture('2024-11-01', 'date.long{}', 'en_US', 'date'), 'November 1, 2024');
});

test('SVG images: paths with arcs, rects, text; the viewBox', () => {
  const svg = svgImage('<svg viewBox="0 0 100 50" width="100mm" height="50mm"><g transform="translate(5,5)"><path d="M 0,0 A 10,10 0 0 1 20,0 H 40 v 10 z" style="fill:#1a1a1a"/><rect x="1" y="2" width="3" height="4" fill="red"/><text x="10" y="20" style="font-size:8px">ABAP</text></g></svg>');
  assert.deepEqual([svg.width, svg.height], [100, 50]);
  const ops = svg.ops((x, y, s) => `TEXT(${s})`);
  assert.match(ops, / c /);            // the arc as Bézier curves
  assert.match(ops, /1 0 0 rg 1 2 3 4 re f/);
  assert.match(ops, /TEXT\(ABAP\)/);
});

test('SAP sample ZF_CINE_TICKET: positioned and rotated fields, floating fields, pictures, SVG logo, image and QR code from the data', () => {
  const logo = Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==', 'base64').toString('base64');
  const xml = `<?xml version="1.0" encoding="UTF-8"?><Form><Ticket><Id>06DBE970F30C1FE0AF991A962D17E17B</Id><Schedule><Begindate>2024-11-01</Begindate><Begintime>13:30:00</Begintime><Endtime>16:30:00</Endtime><Movie><Title>Cloudception</Title><Description>Is it NEO? Is it Cloud Foundry?</Description><Logo>${logo}</Logo></Movie><Room><Name>Cloud44</Name><Address>Dietmar-Hopp-Allee 15</Address><Zip>69190</Zip><Country>Germany</Country></Room></Schedule><Seat><Name>A0</Name></Seat></Ticket></Form>`;
  const r = renderXdp(read('zf_cine_ticket.xdp'), xml, { locale: 'en_US' });
  assert.equal(r.pages, 1);
  const text = r.text[0].join('\n').replace(/\u00a0/g, ' ');
  for (const t of ['Cloudception', 'A0', 'Cloud44', 'Dietmar-Hopp-Allee 15', '69190 Germany', 'Friday, 1. Nov, 2024', 'at 13:30 to 16:30', 'We  ABAP']) assert.ok(text.includes(t), `${t} in\n${text}`);
  assert.ok(!r.warnings.some(w => /Image|Barcode/.test(w)), r.warnings.join('\n'));
  const pdf = r.pdf.toString('latin1');
  assert.match(pdf, /\/Subtype \/Image/);                 // the movie's picture from the data
  assert.match(pdf, /\/MediaBox \[0 0 226\.77 175\.75\]/); // 80 x 62 mm, the template's medium
});

test('SAP sample ZPRA_MF_MUSICFESTIVAL: a table over pages with its header repeated, check boxes, date time picture', () => {
  const rows = Array.from({ length: 60 }, (_, i) => `<Visits><VisitorName>Visitor ${i + 1}</VisitorName><VisitorEmail>v${i + 1}@example.com</VisitorEmail><ArtistIndicator>${i % 7 ? 'false' : 'true'}</ArtistIndicator><StatusText>Booked</StatusText></Visits>`).join('');
  const xml = read('musicfestival.xml').replace(/<_Visits>.*<\/_Visits>/s, `<_Visits>${rows}</_Visits>`);
  const r = renderXdp(read('zpra_mf_musicfestival.xdp'), xml);
  assert.ok(r.pages >= 2, `${r.pages} pages`);
  assert.ok(r.text.every(p => p.includes('Visitor Name')), 'the header row on every page');
  const all = r.text.flat();
  assert.ok(all.includes('Visitor 1') && all.includes('Visitor 60'));
  assert.ok(all.includes('Summer Beats Festival'));
  assert.ok(all.includes('July 18, 2026 at 6:00:00 PM'));
});

test('SAP sample ZFORM_FDP_SCRATCH and the importer fixtures render', () => {
  const r = renderXdp(read('zform_fdp_scratch.xdp'), read('fdp_scratch.xml'));
  assert.ok(r.text[0].includes('FDP Scratch') && r.text[0].includes('DEVELOPER'));
  for (const f of ['zinvoice_adobe.xdp', 'zorder_dynamic.xdp']) assert.ok(renderXdp(read(f), null).pages >= 1, f);
  // JSON data instead of XML
  const j = renderXdp(read('zform_fdp_scratch.xdp'), { ZCE_FDP_SCRATCH_ROOT: { name: 'From JSON' } });
  assert.ok(j.text[0].includes('From JSON'));
});

test('examples/adobe-forms (SAP cinema sample): FDP XML in SAP shape, XSD, check, form reader + read_to_xml_v2 + render_pdf + print queue', () => {
  const dir = path.join(tmp, 'cinema');
  fs.cpSync(new URL('../examples/adobe-forms', import.meta.url).pathname, dir, { recursive: true, filter: f => !f.includes(`${path.sep}.rap`) });
  const ws = new Workspace(dir, { systemDir: false });
  open.push(ws);
  assert.deepEqual(ws.app.diagnostics.errors, []);
  assert.deepEqual(ws.app.diagnostics.warnings.filter(w => /form|xdp/i.test(`${w.file} ${w.message}`)), []);
  const xml = ws.app.rt.formXml('zcine_ticket_srvd', [{ name: 'ID', value: '06DBE970F30C1FE0AF991A962D17E17B' }]);
  assert.match(xml, /^<\?xml[^>]*\?><Form><Ticket><Id>06DBE970F30C1FE0AF991A962D17E17B<\/Id>/);
  assert.match(xml, /<Schedule><Id>[^<]+<\/Id><Begindate>2024-11-01<\/Begindate><Enddate>2024-11-01<\/Enddate><Begintime>13:30:00<\/Begintime>/);
  assert.match(xml, /<Room>.*<Name>Cloud44<\/Name>/);
  assert.match(xml, /<Rendered>false<\/Rendered>/);
  assert.match(xml, /<Logo>\/9j\//);                       // the picture as base64
  const xsd = ws.app.rt.formXsd('zcine_ticket_srvd');
  assert.match(xsd, /<element name="Form"><complexType><sequence><element name="Ticket" type="Ticket"\/>/);
  assert.match(xsd, /<element name="Schedule" type="Schedule" minOccurs="0" maxOccurs="1"\/>/);
  assert.match(xsd, /<element name="Begindate" type="date"/);
  const r = ws.runClass('zcl_cine_print_ticket');
  assert.equal(r.ok, true, r.error);
  assert.match(r.output, /Ticket rendered: 1 page\(s\)/);
  assert.match(r.output, /Print queue item \d+/);
  const row = ws.app.db.prepare('SELECT rendered, pdf FROM zcine_a_buy').get();
  assert.equal(String(row.rendered).trim(), 'X');
  const bytes = typeof row.pdf === 'string' && /^[0-9A-F]+$/i.test(row.pdf) ? Buffer.from(row.pdf, 'hex') : Buffer.from(row.pdf);   // raw strings: hex in the table
  assert.match(bytes.toString('latin1'), /^%PDF/);
});

test('a starter XDP from a data provider: header fields, item table, page numbers; it binds and renders', () => {
  const dir = path.join(tmp, 'billing');
  fs.cpSync(new URL('../examples/forms', import.meta.url).pathname, dir, { recursive: true, filter: f => !f.includes(`${path.sep}.rap`) });
  const ws = new Workspace(dir, { systemDir: false, lint: false });
  open.push(ws);
  const srv = ws.app.model.services.get('zfdp_billingdoc');
  const xdp = generateXdp({ title: 'Invoice', srv, model: ws.app.model });
  const xml = ws.app.rt.formXml('zfdp_billingdoc', []);
  const r = renderXdp(xdp, xml);
  const text = r.text.flat();
  assert.ok(text.includes('Invoice') && text.includes('Page 1 of 1'), text.join('|'));
  assert.ok(text.includes('Customer Name') && text.includes('Billing Date'));
  assert.ok(text.includes('NB-1400') && text.includes('Docking station USB-C'), 'the item rows');
  assert.deepEqual(r.warnings.filter(w => !/font/i.test(w)), []);
});

test('FormCalc: expressions, control flow, functions, user functions', async () => {
  const { runFormCalc } = await import('../src/forms/xfa/formcalc.js');
  const env = { som: p => ({ A: 4, B: '2.5', S: 'abc' })[p] ?? null, assign() {} };
  const fc = s => runFormCalc(s, env);
  assert.equal(fc('A * B + 1'), 11);
  assert.equal(fc('Sum(A, B, 3)'), 9.5);
  assert.equal(fc('Round(10 / 3, 2)'), 3.33);
  assert.equal(fc('if (A > 3) then "big" else "small" endif'), 'big');
  assert.equal(fc('var t = 0\nfor i = 1 upto 4 do t = t + i endfor\nt'), 10);
  assert.equal(fc('var n = 0\nwhile (n < 5) do n = n + 2 endwhile\nn'), 6);
  assert.equal(fc('func Twice(x) do x * 2 endfunc\nTwice(21)'), 42);
  assert.equal(fc('Concat(Upper(S), "-", Len(S))'), 'ABC-3');
  assert.equal(fc('Substr("RAP Studio", 5, 6)'), 'Studio');
  assert.equal(fc('WordNum(1234)'), 'One Thousand Two Hundred Thirty-four');
  assert.equal(fc('A eq 4 and not (B == 3)'), 1);
  assert.equal(fc('HasValue(Missing)'), 0);
  assert.equal(fc('Num2Date(Date2Num("2026-11-05") + 30, "YYYY-MM-DD")'), '2026-12-05');
  // financial (Adobe's reference examples)
  const near = (s, v, d = 2) => assert.equal(Math.round(fc(s) * 10 ** d) / 10 ** d, v, s);
  near('Apr(35000, 269.50, 360)', 0.0852, 4);
  near('CTerm(.02, 1000, 100)', 116.2767, 4);
  near('FV(400, .10/12, 30*12)', 904195.17);
  near('IPmt(30000, .085, 295.50, 7, 3)', 624.88);
  near('NPV(.15, 100000, 120000, 130000, 140000, 50000)', 368075.16);
  near('Pmt(25000, .085/12, 60)', 512.91);
  near('PPmt(30000, .085, 295.50, 7, 3)', 261.62);
  near('PV(1000, .08/12, 5*12)', 49318.43);
  near('Rate(110, 100, 1)', 0.1);
  near('Term(475, .05, 1500)', 3);
  // date and time
  assert.equal(fc('Date2Num("Mar 15, 1996")'), 35138);
  assert.equal(fc('Date2Num("15.03.1996", "DD.MM.YYYY", "de_DE")'), 35138);
  assert.equal(fc('Num2Date(35138)'), 'Mar 15, 1996');
  assert.equal(fc('Num2Date(1, "DD/MM/YYYY")'), '01/01/1900');
  assert.equal(fc('DateFmt(3, "de_DE")'), 'D. MMMM YYYY');
  assert.equal(fc('LocalDateFmt(1)'), 'M/D/YY');
  assert.equal(fc('TimeFmt(1, "de_DE")'), 'HH:MM');
  assert.equal(fc('LocalTimeFmt(2)'), 'h:MM:SS A');
  assert.equal(fc('IsoTime2Num("13:13:13Z")'), 47593000);
  assert.equal(fc('IsoTime2Num("14:13:13+01:00")'), 47593000);
  assert.equal(fc('Time2Num("1:13:13 PM", "h:MM:SS A")'), 47593000);
  assert.equal(fc('Num2GMTime(47593000, "HH:MM:SS")'), '13:13:13');
  assert.equal(fc('Num2Time(43993000, "h:MM A")'), '12:13 PM');
  assert.ok(fc('Time()') > 1.7e12);
  // strings
  assert.equal(fc('Encode("a b&c")'), 'a%20b%26c');
  assert.equal(fc('Decode("a%20b%26c")'), 'a b&c');
  assert.equal(fc('Encode("<a & b>", "html")'), '&lt;a &amp; b&gt;');
  assert.equal(fc('Decode("&lt;x&gt;&#x41;", "xml")'), '<x>A');
  assert.equal(fc('Format("num{z,zz9.99}", 1234.5)'), '1,234.50');
  assert.equal(fc('Format("date{DD.MM.YYYY}", "2026-11-05")'), '05.11.2026');
  assert.equal(fc('Parse("date{MMMM D, YYYY}", "November 5, 2026")'), '2026-11-05');
  assert.equal(fc('Parse("num{z,zz9.99}", "1,234.50")'), 1234.5);
  assert.equal(fc('WordNum(1154.67, 2)'), 'One Thousand One Hundred Fifty-four Dollars And Sixty-seven Cents');
  assert.equal(fc('WordNum(123.45, 1)'), 'One Hundred Twenty-three Dollars');
  assert.equal(fc('Len(Uuid(1))'), 36);
  assert.match(fc('Uuid()'), /^[0-9a-f]{32}$/);
  // miscellaneous, logical, URL
  assert.equal(fc('UnitType("36 in")'), 'in');
  assert.equal(fc('UnitType("2.5cm")'), 'cm');
  assert.equal(fc('UnitValue("2in", "mm")'), 50.8);
  assert.equal(fc('UnitValue("72pt", "in")'), 1);
  assert.equal(fc('Eval("10 * A")'), 40);
  assert.equal(fc('Exists(A)'), 1);
  assert.equal(fc('Exists(Nope)'), 0);
  assert.equal(fc('Ref(A)'), 4);
  assert.equal(fc('Null()'), null);
  assert.equal(fc('Choose(2, "a", "b", "c")'), 'b');
  assert.equal(fc('Oneof(A, 1, 4, 9)'), 1);
  assert.equal(fc('Within(A, 1, 3)'), 0);
  const warned = [];
  assert.equal(runFormCalc('Get("http://example.com")', { ...env, warn: m => warned.push(m) }), null);
  assert.match(warned[0], /no network/);
});

test('XFA scripts: JavaScript and FormCalc calculate, initialize, form:ready, instance manager, script objects, validate, page numbers', () => {
  const xdp = `<?xml version="1.0"?><xdp:xdp xmlns:xdp="http://ns.adobe.com/xdp/"><template xmlns="http://www.xfa.org/schema/xfa-template/3.3/">
  <subform name="form1" layout="tb" locale="en_US">
    <pageSet><pageArea name="P"><contentArea x="10mm" y="20mm" w="190mm" h="250mm"/><medium short="210mm" long="297mm"/>
      <field name="PageNo" x="150mm" y="280mm" w="50mm" h="6mm"><ui><textEdit/></ui>
        <calculate><script contentType="application/x-javascript">"Page " + xfa.layout.page(this) + " of " + xfa.layout.pageCount();</script></calculate></field>
    </pageArea></pageSet>
    <variables><script name="fmt" contentType="application/x-javascript">function money(v) { return "EUR " + v.toFixed(2); }</script></variables>
    <subform name="Items" layout="tb">
      <subform name="Item" layout="lr-tb" w="190mm"><occur min="0" max="-1"/><bind match="dataRef" ref="$.Items.Item[*]"/>
        <field name="Name" w="80mm"><ui><textEdit/></ui><bind match="dataRef" ref="$.Name"/></field>
        <field name="Qty" w="30mm"><ui><numericEdit/></ui><bind match="dataRef" ref="$.Qty"/></field>
        <field name="Price" w="30mm"><ui><numericEdit/></ui><bind match="dataRef" ref="$.Price"/></field>
        <field name="Amount" w="40mm"><ui><numericEdit/></ui><bind match="none"/>
          <calculate><script>Qty * Price</script></calculate></field>
      </subform>
    </subform>
    <field name="Total" w="80mm"><ui><numericEdit/></ui><bind match="none"/><format><picture>num{z,zz9.99}</picture></format>
      <calculate><script>Sum(Items.Item[*].Amount)</script></calculate>
      <validate><script contentType="application/x-javascript">this.rawValue &lt; 1000</script><message><text>Too much</text></message></validate></field>
    <field name="Label" w="80mm"><ui><textEdit/></ui><bind match="none"/>
      <calculate><script contentType="application/x-javascript">fmt.money(Total.rawValue)</script></calculate></field>
    <field name="Rows" w="80mm"><ui><textEdit/></ui><bind match="none"/>
      <calculate><script contentType="application/x-javascript">"Rows: " + Items._Item.count</script></calculate></field>
    <draw name="Banner" w="80mm" h="6mm"><value><text>Big order</text></value></draw>
    <event activity="initialize" ref="$"><script contentType="application/x-javascript">
      var n = Items._Item.addInstance(true); n.Name.rawValue = "Added"; n.Qty.rawValue = 1; n.Price.rawValue = 5;
    </script></event>
    <event activity="ready" ref="$form"><script>if (Total &lt; 1000) then Banner.presence = "hidden" endif</script></event>
  </subform></template></xdp:xdp>`;
  const xml = '<form1><Items><Item><Name>Pen</Name><Qty>2</Qty><Price>1.5</Price></Item><Item><Name>Book</Name><Qty>1</Qty><Price>20</Price></Item></Items></form1>';
  const r = renderXdp(xdp, xml);
  const text = r.text.flat();
  for (const t of ['Pen', '3', 'Book', '20', 'Added', '5', '28.00', 'EUR 28.00', 'Rows: 3', 'Page 1 of 1']) assert.ok(text.includes(t), `${t} in ${text.join('|')}`);
  assert.ok(!text.includes('Big order'), 'form:ready hid the banner');
  assert.deepEqual(r.warnings, []);
  const big = renderXdp(xdp, xml.replace('<Price>20</Price>', '<Price>2000</Price>'));
  assert.ok(big.text.flat().includes('Big order'));
  assert.ok(big.warnings.some(w => /Validation failed: .*Total.*Too much/.test(w)), big.warnings.join('\n'));
  // a script error is reported, the form still renders
  const bad = renderXdp(xdp.replace('Qty * Price', 'Qty * Price )'), xml);
  assert.ok(bad.warnings.some(w => /Script error in .*Amount/.test(w)));
  assert.equal(bad.pages, 1);
});

test('interactive XDP output: open input fields become fillable PDF fields named by SOM; the values read back', async () => {
  const { readFields } = await import('../src/forms/pdfread.js');
  const xml = '<data><HEADER><VBELN>90001</VBELN></HEADER><ITEMS><DATA><POSNR>10</POSNR><NETWR>100.5</NETWR></DATA><DATA><POSNR>20</POSNR><NETWR>1200</NETWR></DATA></ITEMS></data>';
  const xdp = read('zinvoice_adobe.xdp');
  const flat = renderXdp(xdp, xml);
  assert.doesNotMatch(flat.pdf.toString('latin1'), /\/AcroForm/);
  const r = renderXdp(xdp, xml, { interactive: true });
  assert.match(r.pdf.toString('latin1'), /\/AcroForm/);
  const f = readFields(r.pdf);
  assert.equal(f['data[0].Items[0].Row1[1].POSNR[0]'], '20');
  assert.equal(f['data[0].Totals[0].Total[0]'], '1300.5');    // the calculated value as a number; its display pattern is the field's format action
  assert.ok(r.fields.find(x => x.name === 'data[0].Totals[0].Total[0]').display === '1.300,50');
  assert.ok('data[0].Totals[0].Comment[0]' in f && 'data[0].Totals[0].Sign[0]' in f);
  assert.ok(!Object.keys(f).some(k => /Barcode/.test(k)), 'barcodes stay printed');
  // the form's own setting (Designer: config present/pdf/interactive)
  const cfg = xdp.replace('</xdp:xdp>', '<config xmlns="http://www.xfa.org/schema/xci/3.0/"><present><pdf><interactive>1</interactive></pdf></present></config></xdp:xdp>');
  assert.match(renderXdp(cfg, xml).pdf.toString('latin1'), /\/AcroForm/);
});

test('XDP designer: layout boxes of the template objects; a table from the designer binds to the rows', async () => {
  const { tableXml, toPt, mm } = await import('../src/ui/studio/xdp-designer.js');
  assert.equal(mm(toPt('25.4mm')), '25.4mm');
  const table = tableXml('ItemsTable', [['Item', 'Item', 'text', 'Item'], ['Amount', 'Amount', 'decimal', 'Amount']], '$.Order._Items.Items[*]');
  const xdp = `<?xml version="1.0"?><xdp:xdp xmlns:xdp="http://ns.adobe.com/xdp/"><template xmlns="http://www.xfa.org/schema/xfa-template/3.3/">
    <subform name="form1" layout="tb"><pageSet><pageArea name="P"><contentArea x="10mm" y="10mm" w="190mm" h="270mm"/><medium short="210mm" long="297mm"/></pageArea></pageSet>
    ${table}</subform></template></xdp:xdp>`;
  const xml = '<Form><Order><_Items><Items><Item>Pen</Item><Amount>1.5</Amount></Items><Items><Item>Book</Item><Amount>20</Amount></Items></_Items></Order></Form>';
  const r = renderXdp(xdp, xml, { design: true });
  const text = r.text.flat();
  for (const t of ['Item', 'Amount', 'Pen', '1.50', 'Book', '20.00']) assert.ok(text.includes(t), `${t} in ${text.join('|')}`);
  // the boxes: template paths (child indices under <template>), one per painted instance
  const rows = r.layout.boxes.filter(b => b.name === 'Row1');
  assert.equal(rows.length, 2);
  assert.equal(rows[0].path, rows[1].path);
  assert.match(rows[0].path, /^0\/1\/2$/);
  assert.ok(rows[1].y > rows[0].y);
  assert.deepEqual(Object.keys(r.layout.pages[0]).sort(), ['contentArea', 'h', 'pageArea', 'w']);
  assert.equal(r.layout.pages[0].contentArea.path, '0/0/0/0');
});

// a PDF viewer's field model (the Acrobat / PDFium / pdf.js API the field scripts use): runs the PDF's own JavaScript
function viewer(r) {
  const fields = new Map(r.fields.filter(f => f.type !== 'radio').map(f => [f.name, { ...f, value: f.value ?? '', display: 0, readonly: f.readOnly, get valueAsString() { return String(this.value ?? ''); }, checkThisBox(i, on) { this.value = on ? 'Yes' : 'Off'; } }]));
  for (const f of fields.values()) if (f.type === 'checkbox') f.value = f.value ? 'Yes' : 'Off';
  const doc = { getField: n => fields.get(n) || null, numPages: r.pages };
  const alerts = [];
  const run = (code, target) => {
    const event = { value: target?.value, target, rc: true, willCommit: true };
    new Function('event', 'app', 'display', 'util', `${r.docJs || ''}\n${code}`).call(doc, event, { alert: m => alerts.push(m) }, { hidden: 1, visible: 0 }, {});
    return event;
  };
  const recalc = () => { for (const f of fields.values()) if (f.actions?.calculate) f.value = run(f.actions.calculate, f).value; };
  return { fields, alerts, run, set(name, v) { const f = fields.get(name); if (f.actions?.validate && !run(f.actions.validate, { ...f, value: v }).rc) return false; f.value = v; recalc(); return true; },
    click(name) { const f = fields.get(name); f.value = f.value === 'Yes' ? 'Off' : 'Yes'; if (f.actions?.mouseUp) run(f.actions.mouseUp, f); recalc(); } };
}

test('fillable XDP: calculate scripts (JavaScript and FormCalc), click and validate scripts run in the PDF; radio groups; the form font', () => {
  const xml = '<data><ORDERNO>4711</ORDERNO><ITEMS><DATA><MATNR>M1</MATNR><QTY>2</QTY><PRICE>3</PRICE></DATA><DATA><MATNR>M2</MATNR><QTY>3</QTY><PRICE>2.5</PRICE></DATA></ITEMS></data>';
  const r = renderXdp(read('zorder_dynamic.xdp'), xml, { interactive: true });
  assert.match(r.pdf.toString('latin1'), /\/CO \[/);
  assert.match(r.pdf.toString('latin1'), /\/Names << \/JavaScript/);
  const v = viewer(r);
  const name = re => [...v.fields.keys()].find(n => re.test(n));
  assert.equal(v.fields.get(name(/Totals\[0\]\.Total/)).readOnly, true, 'a calculated field is read-only');
  v.set(name(/Line\[0\]\.Qty/), '10');
  assert.equal(Number(v.fields.get(name(/Line\[0\]\.Net/)).value), 30);
  assert.equal(Number(v.fields.get(name(/Totals\[0\]\.Total/)).value), 37.5);    // JavaScript loop over Lines.Line.all
  // the click event: Copy.rawValue = Check.rawValue
  v.set(name(/Check/), 'approved');
  v.click(name(/Trigger/));
  assert.equal(v.fields.get(name(/Copy/)).value, 'approved');
  // FormCalc: Sum(Items.Row1[*].NETWR) of the invoice
  const inv = renderXdp(read('zinvoice_adobe.xdp'), '<data><HEADER><VBELN>9</VBELN></HEADER><ITEMS><DATA><POSNR>10</POSNR><NETWR>100.5</NETWR></DATA><DATA><POSNR>20</POSNR><NETWR>1200</NETWR></DATA></ITEMS></data>', { interactive: true });
  const w = viewer(inv);
  const net = [...w.fields.keys()].filter(n => /Row1\[\d\]\.NETWR/.test(n));
  assert.equal(net.length, 2);
  w.set(net[1], '200');
  assert.equal(Number(w.fields.get([...w.fields.keys()].find(n => /Totals\[0\]\.Total/.test(n))).value), 300.5);
  // validate (JavaScript): the value is refused and the message shown
  const xdp = `<?xml version="1.0"?><xdp:xdp xmlns:xdp="http://ns.adobe.com/xdp/"><template xmlns="http://www.xfa.org/schema/xfa-template/3.3/"><subform name="f" layout="tb"><pageSet><pageArea><contentArea x="10mm" y="10mm" w="190mm" h="270mm"/><medium short="210mm" long="297mm"/></pageArea></pageSet>
    <field name="Age" w="60mm" h="8mm"><ui><numericEdit/></ui><font typeface="Courier New" size="11pt"/><validate><script contentType="application/x-javascript">this.rawValue == null || this.rawValue &lt; 150</script><message><text>Age too high</text></message></validate></field>
    <field name="Next" w="60mm" h="8mm"><ui><numericEdit/></ui><calculate><script>if (HasValue(Age)) then Age + 1 else null endif</script></calculate></field>
    <exclGroup name="Size"><field name="S" w="20mm" h="8mm"><ui><checkButton shape="round"/></ui><items><text>S</text></items></field><field name="M" w="20mm" h="8mm"><ui><checkButton shape="round"/></ui><items><text>M</text></items></field></exclGroup>
  </subform></template></xdp:xdp>`;
  const g = renderXdp(xdp, '<f><Size>M</Size></f>', { interactive: true });
  const x = viewer(g);
  assert.equal(x.set('f[0].Age[0]', '200'), false);
  assert.deepEqual(x.alerts, ['Age too high']);
  assert.equal(x.set('f[0].Age[0]', '41'), true);
  assert.equal(Number(x.fields.get('f[0].Next[0]').value), 42);
  const radios = g.fields.filter(f => f.type === 'radio');
  assert.deepEqual(radios.map(f => [f.group, f.export]), [['f[0].Size[0]', 'S'], ['f[0].Size[0]', 'M']]);
  const t = g.pdf.toString('latin1');
  assert.match(t, /\/FT \/Btn \/Ff 49152 \/T \(f\[0\]\.Size\[0\]\)/);
  assert.match(t, /\/Kids \[\d+ 0 R \d+ 0 R\]/);
  // the field's own font (embedded), not Helvetica, in its default appearance
  const age = g.fields.find(f => f.name === 'f[0].Age[0]');
  assert.ok(age);
  assert.doesNotMatch(t, /\/DA \(\/Helv 11/);
});

test('XDP output as PDF/A-2b (fonts embedded, no JavaScript) and encrypted with passwords', () => {
  const xml = '<data><ORDERNO>4711</ORDERNO><ITEMS><DATA><MATNR>M1</MATNR><QTY>2</QTY><PRICE>3</PRICE></DATA></ITEMS></data>';
  const a = renderXdp(read('zorder_dynamic.xdp'), xml, { pdfa: true, interactive: true });
  const t = a.pdf.toString('latin1');
  assert.match(t, /GTS_PDFA1/);
  assert.doesNotMatch(t, /\/Subtype \/Type1/);         // every font embedded
  assert.doesNotMatch(t, /\/JavaScript/);
  const e = renderXdp(read('zorder_dynamic.xdp'), xml, { security: { userPassword: 'secret', permissions: ['print'] } });
  assert.match(e.pdf.toString('latin1'), /\/Encrypt \d+ 0 R/);
});

test('pagination: overflow leader and trailer on every page, a long text split over pages, page numbers in the body, layout geometry for scripts', () => {
  const rows = Array.from({ length: 70 }, (_, i) => `<Item><Name>Item ${i + 1}</Name><Amount>${i + 1}</Amount></Item>`).join('');
  const long = Array.from({ length: 700 }, (_, i) => `Sentence ${i + 1} of the terms and conditions.`).join(' ');
  const xdp = `<?xml version="1.0"?><xdp:xdp xmlns:xdp="http://ns.adobe.com/xdp/"><template xmlns="http://www.xfa.org/schema/xfa-template/3.3/">
<subform name="f" layout="tb"><pageSet><pageArea name="P"><contentArea x="15mm" y="15mm" w="180mm" h="250mm"/><medium short="210mm" long="297mm"/></pageArea></pageSet>
 <subform name="Items" layout="tb" w="180mm">
  <overflow leader="#Head" trailer="#Cont"/>
  <subform name="Head" id="Head" layout="lr-tb" w="180mm"><draw w="90mm" h="7mm"><value><text>Name</text></value></draw><draw w="90mm" h="7mm"><value><text>Amount</text></value></draw></subform>
  <subform name="Item" layout="lr-tb" w="180mm"><occur min="0" max="-1"/><bind match="dataRef" ref="$.Items.Item[*]"/>
    <field name="Name" w="90mm" h="7mm"><ui><textEdit/></ui><bind match="dataRef" ref="$.Name"/></field>
    <field name="Amount" w="90mm" h="7mm"><ui><numericEdit/></ui><bind match="dataRef" ref="$.Amount"/></field></subform>
  <subform name="Cont" id="Cont" w="180mm" h="8mm"><draw w="180mm" h="8mm"><value><text>Continued on the next page</text></value></draw></subform>
 </subform>
 <draw name="Terms" w="180mm" minH="5mm"><value><text>${long}</text></value><font typeface="Arial" size="10pt"/></draw>
 <field name="Geo" w="150mm" h="7mm"><ui><textEdit/></ui><bind match="none"/><calculate><script contentType="application/x-javascript">"Items table: " + Math.round(xfa.layout.h(Items, "mm")) + " mm on page " + xfa.layout.page(Items) + "; terms start on page " + xfa.layout.page(Terms) + ", " + xfa.layout.pageContent(0, "field").length + " fields on page 1"</script></calculate></field>
 <field name="PageNo" w="60mm" h="7mm"><ui><textEdit/></ui><bind match="none"/><calculate><script contentType="application/x-javascript">"Body page " + xfa.layout.page(this) + " of " + xfa.layout.pageCount()</script></calculate></field>
</subform></template></xdp:xdp>`;
  const r = renderXdp(xdp, `<f><Items>${rows}</Items></f>`);
  assert.equal(r.pages, 6);
  const pagesWith = re => r.text.map(t => t.filter(l => re.test(l)).length);
  assert.deepEqual(pagesWith(/^Name$/), [1, 1, 1, 0, 0, 0]);                 // the leader on every page of the table
  assert.deepEqual(pagesWith(/Continued on the next page/), [1, 1, 0, 0, 0, 0]);   // the trailer where it goes on
  assert.ok(r.text[3].every(l => /terms|conditions|Sentence/.test(l)) && r.text[5].some(l => /Sentence 700 of/.test(l)), 'the terms run over pages 3 to 6');
  assert.ok(r.text[5].includes('Body page 6 of 6'));
  assert.match(r.text.flat().join(' '), /Items table: \d{3} mm on page 1; terms start on page 3, 66 fields on page 1/);
});

test('XDP designer output renders: rich text with sizes and a floating field, event and validate scripts, a second master page used after the first', () => {
  // the XML the designer writes (rich text editor, Scripts section, "+ Master page")
  const xdp = `<?xml version="1.0"?><xdp:xdp xmlns:xdp="http://ns.adobe.com/xdp/"><template xmlns="http://www.xfa.org/schema/xfa-template/3.3/">
  <subform name="form1" layout="tb"><pageSet>
    <pageArea name="Page1" id="Page1"><occur max="1"/><contentArea x="20mm" y="20mm" w="170mm" h="60mm"/><medium stock="a4" short="210mm" long="297mm"/>
      <draw name="First" x="20mm" y="5mm" w="100mm" h="8mm"><ui><textEdit/></ui><value><text>First page header</text></value></draw></pageArea>
    <pageArea name="Page2" id="Page2"><contentArea x="25mm" y="20mm" w="252mm" h="150mm"/><medium stock="a4" short="210mm" long="297mm" orientation="landscape"/>
      <draw name="Next" x="20mm" y="5mm" w="100mm" h="8mm"><ui><textEdit/></ui><value><text>Following pages</text></value></draw></pageArea>
  </pageSet>
  <field name="Member" id="Member" presence="hidden"><ui><textEdit/></ui><bind match="dataRef" ref="$.Member"/></field>
  <draw name="Title" w="170mm" minH="12mm"><ui><textEdit/></ui><value><exData contentType="text/html"><body xmlns="http://www.w3.org/1999/xhtml" xmlns:xfa="http://www.xfa.org/schema/xfa-data/1.0/"><p>Loan <span style="font-size: 24pt; font-weight: bold">Receipt</span> for <span xfa:embed="#Member" xfa:embedType="uri" xfa:embedMode="raw"></span></p></body></exData></value><font typeface="Arial" size="10pt"/></draw>
  <field name="Fee" w="80mm" h="8mm"><ui><numericEdit/></ui><bind match="dataRef" ref="$.Fee"/>
    <validate><script>Fee &gt;= 0</script><message><text>The fee cannot be negative</text></message></validate>
    <event activity="initialize"><script contentType="application/x-javascript">if (this.rawValue == 0) this.presence = "hidden";</script></event></field>
  <subform name="Lines" layout="tb"><subform name="Line" w="170mm" h="20mm"><occur max="-1"/><bind match="dataRef" ref="$.Lines.Line[*]"/>
    <field name="Text" w="170mm" h="8mm"><ui><textEdit/></ui><bind match="dataRef" ref="$.Text"/></field></subform></subform>
  </subform></template></xdp:xdp>`;
  const lines = Array.from({ length: 8 }, (_, i) => `<Line><Text>Line ${i + 1}</Text></Line>`).join('');
  const r = renderXdp(xdp, `<form1><Member>Priya Sharma</Member><Fee>-1</Fee><Lines>${lines}</Lines></form1>`);
  assert.ok(r.pages >= 2, `${r.pages} pages`);
  const p1 = r.text[0].join(' | '), p2 = r.text[1].join(' | ');
  assert.match(p1, /First page header/);
  assert.match(p1, /Loan Receipt for Priya Sharma/);
  assert.match(p2, /Following pages/);
  assert.doesNotMatch(p2, /First page header/);
  assert.ok(r.warnings.some(w => /Validation failed: .*Fee.*cannot be negative/.test(w)), r.warnings.join('\n'));
  assert.match(r.pdf.toString('latin1'), /\/MediaBox \[0 0 841\.89 595\.28\]/);   // the second master page: A4 landscape
  // the initialize event hides the fee when it is 0
  const zero = renderXdp(xdp, '<form1><Member>X</Member><Fee>0</Fee><Lines/></form1>');
  assert.ok(!zero.text.flat().some(t => /^-?0(\.0+)?$/.test(t.trim())), zero.text.flat().join('|'));
});
