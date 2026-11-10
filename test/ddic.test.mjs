// ABAP Dictionary objects created by hand (v0.0.5 Purchase Order scenario): structures with include structures and
// currency references, Z data elements with domains of every common type, table types with a structure line type,
// the checks at activation (invalid values, unknown references with their line), and the same objects on the
// classic engine (a report using TYPE zpo_s_header).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Workspace } from '../src/server/server.js';
import { objectFiles, appContext } from '../src/server/generate.js';
import { classicAvailable } from '../src/classic/build.mjs';
import { abapGitFiles } from '../src/studio/abapgit.js';
import { parseCds } from '../src/ddl/cds.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rap-ddic-'));
fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
const open = [];
after(() => { for (const w of open) w.close(); fs.rmSync(dir, { recursive: true, force: true }); });
const ws0 = (o = {}) => { const w = new Workspace(dir, { dbFile: ':memory:', systemDir: false, lint: false, ...o }); open.push(w); return w; };
const write = files => { for (const [f, t] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), t); } };
const create = (kind, o) => { const ws = ws0(); const r = objectFiles(kind, o, appContext(ws)); ws.close(); write(r.files); return r; };
const errs = ws => ws.app.diagnostics.errors.map(e => `${e.file}:${e.line} ${e.message}`);

test('domains of every common type, data elements with labels, a structure with an include and references', () => {
  create('doma', { name: 'ZPO_STATUS', description: 'PO status', datatype: 'CHAR', length: 1, values: 'N New\nR Released' });
  create('doma', { name: 'ZPO_AMOUNT', description: 'Amount', datatype: 'CURR', length: 15, decimals: 2, sign: true });
  create('doma', { name: 'ZPO_QTY', description: 'Quantity', datatype: 'QUAN', length: 13, decimals: 3 });
  for (const [t, len] of [['NUMC', 10], ['DATS'], ['TIMS'], ['INT1'], ['INT8'], ['STRG'], ['RAW', 16], ['FLTP'], ['UNIT', 3], ['CUKY']]) create('doma', { name: `ZPO_D_${t}`, datatype: t, length: len });
  const dt = create('dtel', { name: 'ZPO_EBELN', description: 'Purchase order number', datatype: 'CHAR', length: 10, short: 'PO', medium: 'PO number', long: 'Purchase order number', heading: 'PO number' });
  const x = dt.files['src/zpo_ebeln.dtel.xml'];
  assert.match(x, /<SCRTEXT_S>PO<\/SCRTEXT_S>/);
  assert.match(x, /<SCRTEXT_M>PO number<\/SCRTEXT_M>/);
  assert.match(x, /<SCRTEXT_L>Purchase order number<\/SCRTEXT_L>/);
  create('dtel', { name: 'ZPO_NETWR', description: 'Net value', domain: 'ZPO_AMOUNT' });
  create('dtel', { name: 'ZPO_MENGE', description: 'Quantity', domain: 'ZPO_QTY' });
  // an unknown domain is refused by the dialog
  assert.throws(() => objectFiles('dtel', { name: 'ZPO_BAD', domain: 'ZPO_DOES_NOT_EXIST' }, appContext(ws0())), /Domain ZPO_DOES_NOT_EXIST does not exist/);
  create('stru', { name: 'ZPO_S_ADMIN', description: 'Admin data', fields: 'ernam abap.char(12)\nerdat abap.dats' });
  const s = create('stru', { name: 'ZPO_S_HEADER', description: 'PO header', fields: 'ebeln zpo_ebeln\nnetwr zpo_netwr ref waers\nwaers abap.cuky\nstatus abap.char(1)\ninclude zpo_s_admin' });
  const src = s.files['src/zpo_s_header.tabl.cds'];
  assert.match(src, /define structure zpo_s_header \{/);
  assert.match(src, /@Semantics\.amount\.currencyCode : 'zpo_s_header\.waers'/);
  assert.match(src, /include zpo_s_admin;/);
  create('stru', { name: 'ZPO_S_ITEM', description: 'PO item', fields: 'ebelp abap.numc(5)\nmatnr abap.char(18)\nmenge zpo_menge ref meins\nmeins abap.unit(3)\nnetpr zpo_netwr ref waers\nwaers abap.cuky' });
  const tt = create('ttyp', { name: 'ZPO_T_ITEM', description: 'PO items', rowtype: 'ZPO_S_ITEM' });
  assert.match(tt.files['src/zpo_t_item.ttyp.xml'], /<ROWTYPE>ZPO_S_ITEM<\/ROWTYPE>/);
  create('table', { name: 'ZPO_HEAD', description: 'PO header', uuidKey: false, admin: false, keys: 'ebeln zpo_ebeln', fields: 'lifnr abap.char(10)\nnetwr zpo_netwr ref waers\nwaers abap.cuky\ninclude zpo_s_admin', deliveryClass: 'A', dataClass: 'APPL1', sizeCategory: '1', buffering: 'NOT_ALLOWED' });
  const ws = ws0();
  assert.deepEqual(errs(ws), []);
  // structures are types (RAP runtime): components with the domains' built-in types, the include written out
  const st = ws.app.model.structures.get('zpo_s_header');
  assert.deepEqual(st.fields.map(f => f.name), ['ebeln', 'netwr', 'waers', 'status', 'ernam', 'erdat']);
  assert.deepEqual(st.fields.find(f => f.name === 'netwr').ti, { t: 'p', len: 15, dec: 2, de: 'zpo_netwr' });
  assert.ok(!ws.app.model.tables.has('zpo_s_header'));                       // no database table
  assert.deepEqual(ws.app.model.tables.get('zpo_head').fields.map(f => f.name), ['ebeln', 'lifnr', 'netwr', 'waers', 'ernam', 'erdat']);
  // technical settings and the delivery class are annotations of the table; the export writes DD09L / CONTFLAG
  const tab = parseCds(fs.readFileSync(path.join(dir, 'src/zpo_head.tabl.cds'), 'utf8'), 'x')[0];
  assert.equal(tab.ann.abapcatalog.deliveryclass, '#A');
  const git = abapGitFiles(dir);
  assert.match(git.get('src/zpo_s_header.tabl.xml'), /<TABCLASS>INTTAB<\/TABCLASS>/);
  assert.match(git.get('src/zpo_s_header.tabl.xml'), /<REFTABLE>ZPO_S_HEADER<\/REFTABLE>\s*<REFFIELD>WAERS<\/REFFIELD>/);
  assert.match(git.get('src/zpo_head.tabl.xml'), /<TABART>APPL1<\/TABART>/);
  assert.match(git.get('src/zpo_head.tabl.xml'), /<TABKAT>1<\/TABKAT>/);
  assert.ok(git.has('src/zpo_status.doma.xml'));
  // used in ABAP on the RAP runtime: TYPE structure, TYPE table type, a data element with a CURR domain
  write({ 'src/zcl_po_types_demo.clas.abap': `CLASS zcl_po_types_demo DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES if_oo_adt_classrun.
ENDCLASS.
CLASS zcl_po_types_demo IMPLEMENTATION.
  METHOD if_oo_adt_classrun~main.
    DATA ls_header TYPE zpo_s_header.
    DATA lt_items TYPE zpo_t_item.
    DATA lv_netwr TYPE zpo_netwr.
    ls_header-ebeln = '4500000001'.
    ls_header-ernam = 'BUYER'.
    lv_netwr = '1234.5'.
    ls_header-netwr = lv_netwr * 2.
    APPEND VALUE #( ebelp = '00010' matnr = 'M-1' menge = 3 ) TO lt_items.
    out->write( |{ ls_header-ebeln } { ls_header-netwr } { ls_header-ernam } { lines( lt_items ) } { lt_items[ 1 ]-menge }| ).
  ENDMETHOD.
ENDCLASS.
` });
  const ws2 = ws0();
  assert.deepEqual(errs(ws2), []);
  const r = ws2.runClass('zcl_po_types_demo');
  assert.ok(r.ok, r.error);
  assert.equal(r.output, '4500000001 2469.00 BUYER 1 3');
});

test('activation reports invalid DDIC values and unknown references with their line', () => {
  write({
    'src/zpo_badleng.doma.xml': fs.readFileSync(path.join(dir, 'src/zpo_status.doma.xml'), 'utf8').replace('ZPO_STATUS', 'ZPO_BADLENG').replace(/<LENG>\d+<\/LENG>/, '<LENG>QUAN</LENG>'),
    'src/zpo_badtype.doma.xml': fs.readFileSync(path.join(dir, 'src/zpo_status.doma.xml'), 'utf8').replace('ZPO_STATUS', 'ZPO_BADTYPE').replace('<DATATYPE>CHAR</DATATYPE>', '<DATATYPE>CHARX</DATATYPE>'),
    'src/zpo_baddom.dtel.xml': fs.readFileSync(path.join(dir, 'src/zpo_netwr.dtel.xml'), 'utf8').replace('ZPO_NETWR', 'ZPO_BADDOM').replace('ZPO_AMOUNT', 'ZPO_DOES_NOT_EXIST'),
    'src/zpo_t_bad.ttyp.xml': fs.readFileSync(path.join(dir, 'src/zpo_t_item.ttyp.xml'), 'utf8').replace('ZPO_T_ITEM', 'ZPO_T_BAD').replace('ZPO_S_ITEM', 'ZPO_S_NOPE'),
    'src/zpo_s_bad.tabl.cds': "@EndUserText.label : 'Bad'\ndefine structure zpo_s_bad {\n  a : zpo_nothere;\n  @Semantics.amount.currencyCode : 'zpo_s_bad.waers'\n  b : abap.curr(15,2);\n  include zpo_s_missing;\n}\n",
  });
  const e = errs(ws0());
  const has = re => assert.ok(e.some(x => re.test(x)), `${re} in\n${e.join('\n')}`);
  has(/zpo_badleng\.doma\.xml:\d+ Domain ZPO_BADLENG: the length "QUAN" is not a number/);
  has(/zpo_badtype\.doma\.xml:\d+ Domain ZPO_BADTYPE: unknown data type CHARX/);
  has(/zpo_baddom\.dtel\.xml:8 Data element ZPO_BADDOM: domain ZPO_DOES_NOT_EXIST does not exist/);
  has(/zpo_t_bad\.ttyp\.xml:\d+ Table type ZPO_T_BAD: line type ZPO_S_NOPE does not exist/);
  has(/zpo_s_bad\.tabl\.cds:3 Structure zpo_s_bad: the type ZPO_NOTHERE of a does not exist/);
  has(/zpo_s_bad\.tabl\.cds:5 Structure zpo_s_bad: the currency key field zpo_s_bad\.waers of b does not exist/);
  has(/zpo_s_bad\.tabl\.cds:6 Structure zpo_s_bad: Include structure ZPO_S_MISSING does not exist/);
  for (const f of ['zpo_badleng.doma.xml', 'zpo_badtype.doma.xml', 'zpo_baddom.dtel.xml', 'zpo_t_bad.ttyp.xml', 'zpo_s_bad.tabl.cds']) fs.rmSync(path.join(dir, 'src', f));
});

const skip = !classicAvailable() ? 'classic engine not installed' : /^pglite|^postgres/.test(process.env.RAP_DB || '') ? 'the classic engine uses SQLite' : false;
test('classic engine: a report types its data with the structure, the table type and the data elements', { skip, timeout: 180000 }, async () => {
  create('report', { name: 'ZPO_TYPES', description: 'Types' });
  write({ 'src/zpo_types.prog.abap': `REPORT zpo_types.
DATA gs_header TYPE zpo_s_header.
DATA gt_items TYPE zpo_t_item.
DATA gs_item TYPE zpo_s_item.
START-OF-SELECTION.
  gs_header-ebeln = '4500000007'.
  gs_header-ernam = 'BUYER'.
  gs_header-netwr = '99.50'.
  gs_item-ebelp = 10.
  gs_item-menge = '2.500'.
  APPEND gs_item TO gt_items.
  WRITE: / |PO { gs_header-ebeln } by { gs_header-ernam } value { gs_header-netwr } items { lines( gt_items ) }|.
` });
  // a selection text with a dictionary reference (TPOOL "D       .") shows the data element's label
  create('report', { name: 'ZPO_SEL', description: 'Selection' });
  write({ 'src/zpo_sel.prog.abap': "REPORT zpo_sel.\nPARAMETERS p_ebeln TYPE zpo_ebeln.\nSTART-OF-SELECTION.\n  WRITE: / p_ebeln.\n" });
  write({ 'src/zpo_sel.prog.xml': fs.readFileSync(path.join(dir, 'src/zpo_sel.prog.xml'), 'utf8').replace(/(\s*<\/TPOOL>)/, '\n    <item>\n     <ID>S</ID>\n     <KEY>P_EBELN</KEY>\n     <ENTRY>D       .</ENTRY>\n     <LENGTH>9</LENGTH>\n    </item>$1') });
  const ws = new Workspace(dir, { systemDir: false, lint: false });
  open.push(ws);
  const st = await ws.classic.ensure();
  assert.equal(st.state, 'running', JSON.stringify(st.diagnostics));
  const base = st.url.replace('localhost', '127.0.0.1');
  // no selection screen: the list comes right away
  const html = await (await fetch(`${base}program?name=ZPO_TYPES`)).text();
  const text = html.replace(/<(style|script)[\s\S]*?<\/\1>/g, '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');
  assert.match(text, /PO 4500000007 by BUYER value 99\.50 items 1/);
  const sel = await (await fetch(`${base}program?name=ZPO_SEL`)).text();
  assert.ok(sel.includes('PO number'), 'the data element\'s medium label');
  assert.doesNotMatch(sel, /D {7}\./);
});

test('code checks know the app dictionary: a table type with a CDS structure line type resolves (ATC-01)', async () => {
  const { runAtc } = await import('../src/check/atc.js');
  const r = runAtc(new URL('./fixtures/po-classic', import.meta.url).pathname);
  const bad = r.findings.filter(f => /not a table type|ZPO_T_ITEMS not found/i.test(f.message));
  assert.deepEqual(bad, []);
  assert.equal(r.findings.filter(f => f.severity === 'error').length, 0);
});
