// Fixes for what the RAP Studio 0.0.5 launch recording and the GenUI5 demo surfaced: FM test page dates and times,
// initial dates on Adobe forms, the debugger toolbar, the text elements editor, labels and table control widths,
// $filter with $apply, and local classes of the same name in two behavior pools.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import { classicAvailable } from '../src/classic/build.mjs';
import { Workspace } from '../src/server/server.js';
import { objectFiles, appContext } from '../src/server/generate.js';
import { pdfText } from '../src/classic/client.mjs';
import * as C from '../src/ui/studio/visual/classic.js';
import * as M from '../src/ui/studio/visual/models.js';

const open = [], dirs = [];
after(() => { for (const w of open) w.close(); for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
const tmp = prefix => { const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix)); dirs.push(d); return d; };

test('FM test page: DATS / TIMS parameters take DD.MM.YYYY / YYYYMMDD and HH:MM:SS, anything else is a field error', async () => {
  const { parseDate, parseTime, runFunction, shapeOf } = await import('../src/classic/functions.mjs');
  const { functionPage } = await import('../src/classic/system.mjs');
  assert.equal(parseDate('10.11.2026'), '20261110');
  assert.equal(parseDate('20261110'), '20261110');
  for (const bad of ['10.11.20', '31.02.2026', '2026-11-10', '1.11.2026', 'today']) assert.equal(parseDate(bad), null, bad);
  assert.equal(parseTime('13:45:30'), '134530');
  assert.equal(parseTime('134530'), '134530');
  for (const bad of ['25:00:00', '13:45', '1:2:3']) assert.equal(parseTime(bad), null, bad);

  // a function module with a structure parameter (BEDAT a date, UZEIT a time) and a date parameter
  const work = tmp('rap-fmdate-');
  fs.mkdirSync(path.join(work, 'app'));
  fs.writeFileSync(path.join(work, 'app', 'zfg_dt.fugr.z_dt_echo.abap'), `FUNCTION z_dt_echo.
*"----------------------------------------------------------------------
*"*"Local Interface:
*"  IMPORTING
*"     VALUE(IS_HEAD) TYPE  ZDT_S_HEAD
*"     VALUE(IV_DATE) TYPE  D OPTIONAL
*"  EXPORTING
*"     VALUE(EV_BEDAT) TYPE  D
*"     VALUE(EV_UZEIT) TYPE  T
*"     VALUE(EV_DATE) TYPE  D
*"----------------------------------------------------------------------
ENDFUNCTION.
`);
  const { ABAP } = await import('@abaplint/runtime');
  const abap = new ABAP();
  const T = abap.types;
  abap.DDIC.ZDT_S_HEAD = { objectType: 'TABL', type: new T.Structure({ ebeln: new T.Character(10), bedat: new T.Date(), uzeit: new T.Time() }) };
  abap.FunctionModules.Z_DT_ECHO = async ({ exporting, importing }) => {
    importing.ev_bedat.set(exporting.is_head.get().bedat.get());
    importing.ev_uzeit.set(exporting.is_head.get().uzeit.get());
    importing.ev_date.set(exporting.iv_date?.get() ?? '');
  };
  const ok = await runFunction(abap, work, 'Z_DT_ECHO', { IS_HEAD: JSON.stringify({ EBELN: '4500000001', BEDAT: '10.11.2026', UZEIT: '08:30:00' }), IV_DATE: '20261231' });
  assert.equal(ok.exporting.EV_BEDAT, '20261110');   // not 10.11.20 (truncated)
  assert.equal(ok.exporting.EV_UZEIT, '083000');
  assert.equal(ok.exporting.EV_DATE, '20261231');
  // wrong input: no call, a field error per field
  let err = null;
  try { await runFunction(abap, work, 'Z_DT_ECHO', { IS_HEAD: { BEDAT: '10.11.20', UZEIT: '8:30' }, IV_DATE: '2026-12-31' }); } catch (e) { err = e; }
  assert.ok(err, 'the call is rejected');
  assert.equal(err.status, 400);
  assert.deepEqual(err.fields.map(f => f.field).sort(), ['IS_HEAD-BEDAT', 'IS_HEAD-UZEIT', 'IV_DATE']);
  assert.match(err.fields.find(f => f.field === 'IS_HEAD-BEDAT').message, /"10\.11\.20" is not a valid date \(DD\.MM\.YYYY or YYYYMMDD\)/);
  // the form: date components say their format, the wrong ones are marked with the reason
  const sh = shapeOf(abap, { typ: 'ZDT_S_HEAD' }, 'IMPORTING');
  assert.deepEqual(sh.kinds, { BEDAT: 'D', UZEIT: 'T' });
  const fn = { name: 'Z_DT_ECHO', group: 'ZFG_DT', sections: { IMPORTING: [{ parameter: 'IS_HEAD', typ: 'ZDT_S_HEAD', shape: 'TABL', ...sh }, { parameter: 'IV_DATE', typ: 'D', ...shapeOf(abap, { typ: 'D' }, 'IMPORTING') }] } };
  const html = functionPage({ app: 'x' }, fn, { IS_HEAD: '{"BEDAT":"10.11.20"}', IV_DATE: '2026-12-31' }, { error: err.message, fields: err.fields, subrc: 0, ms: 0, exporting: {}, changing: {}, tables: {} });
  assert.match(html, /data-c="BEDAT" value="10\.11\.20"[^>]*placeholder="DD\.MM\.YYYY" aria-invalid="true"/);
  assert.match(html, /name="IV_DATE" value="2026-12-31" placeholder="DD\.MM\.YYYY" aria-invalid="true"/);
  assert.match(html, /Not executed: correct the marked fields/);
});

test('Adobe forms: an initial date or time prints blank, a set date as DD.MM.YYYY (classic print programs and the RAP path)', async () => {
  const { renderXdp } = await import('../src/forms/xfa/render.js');
  const { formatPicture } = await import('../src/forms/xfa/picture.js');
  const { toJs } = await import('../src/classic/forms.mjs');
  const { adsData } = await import('../src/forms/interface.js');
  // ABAP data of a classic print program: dates and times as ADS gets them, initial ones empty
  const { ABAP } = await import('@abaplint/runtime');
  const T = new ABAP().types;
  const s = new T.Structure({ bedat: new T.Date(), eindt: new T.Date(), uzeit: new T.Time(), ebeln: new T.Character(10) });
  s.get().eindt.set('20261110'); s.get().ebeln.set('4500000001');
  assert.deepEqual(toJs(s, true), { bedat: '', eindt: '2026-11-10', uzeit: '', ebeln: '4500000001' });
  assert.deepEqual(toJs(s), { bedat: '00000000', eindt: '20261110', uzeit: '000000', ebeln: '4500000001' });   // other layouts: as before
  // the RAP runtime's classic form path: by the form interface's types
  assert.deepEqual(adsData({ is_h: { bedat: '00000000', eindt: '20261110', uzeit: '000000', ebeln: '00000000' } },
    [{ name: 'IS_H', shape: 'struct', fields: [{ name: 'BEDAT', ti: { t: 'd' } }, { name: 'EINDT', ti: { t: 'd' } }, { name: 'UZEIT', ti: { t: 't' } }, { name: 'EBELN', ti: { t: 'c' } }] }]),
  { is_h: { bedat: '', eindt: '2026-11-10', uzeit: '', ebeln: '00000000' } });
  // a date picture never prints 00000000
  assert.equal(formatPicture('00000000', 'date{DD.MM.YYYY}', 'en_US', 'date'), '');
  assert.equal(formatPicture('20261110', 'date{DD.MM.YYYY}', 'en_US', 'date'), '10.11.2026');
  // the layout: a date field with a picture, a text field without one, both bound to dates
  const xdp = `<?xml version="1.0" encoding="UTF-8"?>
<xdp:xdp xmlns:xdp="http://ns.adobe.com/xdp/"><template xmlns="http://www.xfa.org/schema/xfa-template/3.3/">
<subform name="form1" layout="tb" locale="en_US"><pageSet><pageArea name="P"><contentArea x="10mm" y="10mm" w="190mm" h="270mm"/><medium stock="a4" short="210mm" long="297mm"/></pageArea></pageSet>
<subform name="body" layout="tb" w="190mm"><bind match="none"/>
<field name="BEDAT" w="80mm" h="8mm"><ui><dateTimeEdit/></ui><caption reserve="30mm"><value><text>Doc date</text></value></caption><value><date/></value><format><picture>date{DD.MM.YYYY}</picture></format><bind match="dataRef" ref="$.IS_H.BEDAT"/></field>
<field name="EINDT" w="80mm" h="8mm"><ui><textEdit/></ui><caption reserve="30mm"><value><text>Delivery</text></value></caption><bind match="dataRef" ref="$.IS_H.EINDT"/></field>
<field name="UZEIT" w="80mm" h="8mm"><ui><textEdit/></ui><caption reserve="30mm"><value><text>Time</text></value></caption><bind match="dataRef" ref="$.IS_H.UZEIT"/></field>
</subform></subform></template></xdp:xdp>`;
  const text = data => pdfText(renderXdp(xdp, data, { userDateFormat: 'DD.MM.YYYY' }).pdf).join('|');
  const printed = text({ is_h: toJs(s, true) });
  assert.doesNotMatch(printed, /00000000|000000/);
  assert.match(printed, /10\.11\.2026/);
  assert.doesNotMatch(printed, /2026-11-10/);
  // data that still carries 00000000 (an XML of another source) prints blank in a date field too
  assert.doesNotMatch(pdfText(renderXdp(xdp, { is_h: { bedat: '00000000' } }).pdf).join('|'), /00000000/);
});

test('debugger toolbar: every button is always there in the same order, disabled where it does not apply', () => {
  const src = fs.readFileSync(new URL('../src/ui/studio/studio.js', import.meta.url), 'utf8');
  const fn = /function renderDebugger\(\) \{[\s\S]*?\n\}\n/.exec(src)[0];
  const el = { hidden: true, innerHTML: '', classList: { toggle() {} }, querySelectorAll: () => [], querySelector: () => null };
  const ctx = { S: {}, $: () => el, esc: s => String(s ?? ''), armedKind: k => k === 'rap' || k === 'classic', watchHtml: () => '', dbgRows: () => '', dbgValue: () => '', renderBreakpoints() {}, watchList: () => [], document: {}, location: {} };
  vm.createContext(ctx);
  vm.runInContext(`${fn}; this.render = renderDebugger;`, ctx);
  const buttons = st => {
    ctx.S.dbg = st; ctx.render();
    return [...el.innerHTML.matchAll(/<button class="btn sm[^"]*" data-dc="(\w+)"([^>]*)>/g)].map(m => `${m[1]}${/disabled/.test(m[2]) ? '-' : '+'}`);
  };
  const paused = { kind: 'rap', status: 'paused', paused: { stack: ['LHC_TRAVEL->SETSTATUS', 'ZBP->X'], line: 10, vars: {}, sy: {}, frames: [] } };
  const top = { kind: 'rap', status: 'paused', paused: { stack: ['LHC_TRAVEL->SETSTATUS'], line: 10, vars: {}, sy: {}, frames: [] } };
  const running = { kind: 'rap', status: 'running', paused: null };
  const armed = { kind: 'rap', status: 'armed', paused: null };
  const order = b => b.map(x => x.slice(0, -1));
  const a = buttons(paused), b = buttons(running), c = buttons(top), d = buttons(armed);
  assert.deepEqual(order(a), ['into', 'over', 'out', 'continue', 'hide', 'stop', 'close']);
  for (const x of [b, c, d]) assert.deepEqual(order(x), order(a), 'the same buttons in the same order between stops');
  assert.deepEqual(a.slice(0, 4), ['into+', 'over+', 'out+', 'continue+']);
  assert.deepEqual(b.slice(0, 4), ['into-', 'over-', 'out-', 'continue-']);   // running: disabled, not gone
  assert.equal(c[2], 'out-');   // Return at the top frame: nothing to return to
  // the class run (not armed): no Hide, still a fixed set
  assert.deepEqual(order(buttons({ kind: 'class', status: 'paused', paused: paused.paused })), ['into', 'over', 'out', 'continue', 'stop', 'close']);
  assert.deepEqual(order(buttons({ kind: 'class', status: 'running', paused: null })), ['into', 'over', 'out', 'continue', 'stop', 'close']);
  // the compact state no longer hides the step buttons
  const css = fs.readFileSync(new URL('../src/ui/studio/studio.css', import.meta.url), 'utf8');
  assert.doesNotMatch(css, /\.dbg\.compact \.dbg-steps \{ display: none/);
  assert.doesNotMatch(css, /\.dbg\.compact \.dbg-head \[data-dc="into"\]/);
});

test('text elements: no template leftovers, a dictionary reference is only the marker, labels for built-in typed fields', () => {
  // a dictionary reference never writes a text (or an explanation) into the text pool
  const xml = '<abapGit><asx:abap><asx:values><PROGDIR><NAME>ZR</NAME></PROGDIR></asx:values></asx:abap></abapGit>';
  const out = C.writeTpool(xml, { title: 'R', symbols: [], headings: [], selections: [{ key: 'S_LIFNR', text: '(zpo_head-lifnr: no data element or label)', ddic: true }, { key: 'P_MAX', text: 'Maximum rows', ddic: false }] });
  assert.doesNotMatch(out, /no data element/);
  assert.match(out, /<KEY>S_LIFNR<\/KEY>\s*<ENTRY>D {7}\.<\/ENTRY>/);
  assert.deepEqual(C.parseTpool(out).selections, [{ key: 'S_LIFNR', text: '', ddic: true }, { key: 'P_MAX', text: 'Maximum rows', ddic: false }]);
  // the report template: selection texts only for the parameters its program has
  const app = tmp('rap-tpool-');
  fs.mkdirSync(path.join(app, 'src'));
  const w = new Workspace(app, { dbFile: ':memory:', systemDir: false, lint: false }); open.push(w);
  const r = objectFiles('report', { name: 'ZR_HELLO', description: 'Hello' }, appContext(w));
  const tp = C.parseTpool(r.files['src/zr_hello.prog.xml']);
  const names = C.selectionNames(r.files['src/zr_hello.prog.abap']);
  assert.deepEqual(tp.selections.map(x => x.key).filter(k => !names.includes(k)), []);
  // the editor: a delete action for texts of parameters the program does not have; no dictionary reference (and
  // no placeholder) for a field typed with a built-in type
  const ed = fs.readFileSync(new URL('../src/ui/studio/visual/editors.js', import.meta.url), 'utf8');
  assert.match(ed, /data-do="del" data-l="tpool\.selections"[^`]*is not in the program/);
  assert.match(ed, /noDtel && !x\.ddic\) \|\| !inProg \? ' disabled'/);
  assert.doesNotMatch(ed, /no data element or label/);
  assert.doesNotMatch(ed, /r\.label \|\| `\(\$\{r\.error\}\)`/);
});

test('labels and table controls: @EndUserText.label for built-in typed fields, columns as wide as output length and heading', () => {
  const cds = "@EndUserText.label : 'PO items'\ndefine table zpo_item {\n  key client : abap.clnt not null;\n  key ebeln : abap.char(10) not null;\n  key ebelp : abap.numc(5) not null;\n  @EndUserText.label : 'Old'\n  bukrs : abap.char(4);\n  bedat : abap.dats;\n}\n";
  const next = M.addFieldLabels(cds, { EBELP: 'Item', bukrs: 'Company code', BEDAT: "Doc's date" });
  const f = Object.fromEntries(M.parseTable(next).fields.map(x => [x.name, x.anns['EndUserText.label']]));
  assert.deepEqual(f, { client: undefined, ebeln: undefined, ebelp: 'Item', bukrs: 'Company code', bedat: 'Doc’s date' });
  assert.equal((next.match(/EndUserText\.label/g) || []).length, 4);   // replaced, not doubled
  // the table control: EBELP NUMC 5 under "Item" keeps 5 visible characters (and a long heading widens the column)
  const tc = C.tableControl({ name: 'TC_ITEMS', line: 2, column: 1, wa: 'GS_ITEM', columns: [{ name: 'EBELP', label: 'Item', length: 5, format: 'NUMC' }, { name: 'WAERS', label: 'Currency key', length: 5, format: 'CUKY' }] });
  const col = n => tc.fields.find(x => x.type === 'TEMPLATE' && x.name === `GS_ITEM-${n}`);
  assert.equal(col('EBELP').length, 5);
  assert.ok(col('EBELP').vislength >= 5 && col('EBELP').vislength >= 'Item'.length);
  assert.ok(col('WAERS').vislength >= 'Currency key'.length);
  // the field picker and the wizard offer labels for fields that have none
  const ed = fs.readFileSync(new URL('../src/ui/studio/visual/editors.js', import.meta.url), 'utf8');
  assert.match(ed, /labelInputs\(p\.comps, 'data-plabel'\)/);
  assert.match(ed, /labelInputs\(w\.cols\.slice\(0, 12\), 'data-wlabel'\)/);
  assert.match(ed, /M\.addFieldLabels\(tx, labels\)/);
});

test('XDP generation: a field with @EndUserText.label (built-in type) gets it as caption', () => {
  const app = tmp('rap-lbl-');
  fs.mkdirSync(path.join(app, 'src'));
  fs.writeFileSync(path.join(app, 'src/zlb_head.tabl.cds'), "@EndUserText.label : 'Head'\ndefine table zlb_head {\n  key client : abap.clnt not null;\n  key ebeln : abap.char(10) not null;\n  @EndUserText.label : 'Company code'\n  bukrs : abap.char(4);\n}\n");
  const w = new Workspace(app, { dbFile: ':memory:', systemDir: false, lint: false }); open.push(w);
  const r = objectFiles('xdpform', { name: 'ZF_LB', source: 'interface', params: 'IS_H TYPE ZLB_HEAD' }, appContext(w));
  assert.match(r.files['src/zf_lb.xdp'], /<text>Company code<\/text>/);
});

test('OData: $filter together with $apply (on the result; properties the result lacks filter the rows first), and $apply=filter(...)/groupby(...)', () => {
  const ws = new Workspace(new URL('../examples/travel', import.meta.url).pathname, { dbFile: ':memory:' }); open.push(ws);
  const call = u => { try { return ws.odata.handle('GET', u); } catch (e) { return { status: e.status || 500, body: { error: e.message } }; } };
  const S = '/odata/zui_travel/Travel';
  const grp = '$apply=groupby((CurrencyCode),aggregate(TotalPrice with sum as Total,$count as Cnt))';
  const viaFilter = call(`${S}?$filter=IsActiveEntity eq true&${grp}`);
  assert.equal(viaFilter.status, 200, JSON.stringify(viaFilter.body));
  const viaApply = call(`${S}?$apply=filter(IsActiveEntity eq true)/groupby((CurrencyCode),aggregate(TotalPrice with sum as Total,$count as Cnt))`);
  assert.equal(viaApply.status, 200, JSON.stringify(viaApply.body));
  assert.deepEqual(viaFilter.body.value, viaApply.body.value);
  assert.equal(viaFilter.body.value.reduce((n, r) => n + r.Cnt, 0), 3);
  // the filter restricts the rows before grouping
  const eur = call(`${S}?$filter=IsActiveEntity eq true and CurrencyCode eq 'EUR'&${grp}`);
  assert.equal(eur.status, 200, JSON.stringify(eur.body));
  assert.deepEqual(eur.body.value.map(r => r.CurrencyCode), ['EUR']);
  // a $filter on what the aggregation produces still works on its result
  const big = call(`${S}?$filter=Total gt 100&${grp}`);
  assert.equal(big.status, 200, JSON.stringify(big.body));
  assert.ok(big.body.value.every(r => r.Total > 100));
  const cnt = call(`${S}?$filter=IsActiveEntity eq true&$apply=aggregate($count as Cnt)&$count=true`);
  assert.equal(cnt.status, 200, JSON.stringify(cnt.body));
  assert.equal(cnt.body.value[0].Cnt, 3);
  // strict OData V4: a $filter on a property the aggregation produces under the same name filters the result (the
  // sums), not the rows
  const same = '$apply=filter(IsActiveEntity eq true)/groupby((CurrencyCode),aggregate(TotalPrice with sum as TotalPrice))';
  const all = call(`${S}?${same}`).body.value;
  const t = Math.min(...all.map(r => Number(r.TotalPrice))) - 0.01;
  const strict = call(`${S}?$filter=TotalPrice gt ${t}&${same}`);
  assert.equal(strict.status, 200, JSON.stringify(strict.body));
  assert.deepEqual(strict.body.value, all.filter(r => Number(r.TotalPrice) > t), 'every group whose sum is above the limit, with its full sum');
  // a mixed filter: the result's property on the result, IsActiveEntity (gone after groupby) on the rows
  const mixed = call(`${S}?$filter=IsActiveEntity eq true and Total gt 0&${grp}`);
  assert.equal(mixed.status, 200, JSON.stringify(mixed.body));
  assert.deepEqual(mixed.body.value, viaFilter.body.value.filter(r => r.Total > 0));
  assert.equal(call(`${S}?$filter=Nope eq 1&${grp}`).status, 400);
});

test('two behavior pools with a local handler class of the same name (lhc_item) each keep their own', () => {
  const app = tmp('rap-lhc-');
  fs.mkdirSync(path.join(app, 'src'));
  const put = (f, t) => fs.writeFileSync(path.join(app, 'src', f), t);
  for (const [x, prefix] of [['a', 'A'], ['b', 'B']]) {
    put(`zlh_${x}.tabl.cds`, `@EndUserText.label : 'Items ${prefix}'\ndefine table zlh_${x} {\n  key client : abap.clnt not null;\n  key item_id : abap.char(10) not null;\n  title : abap.char(60);\n}\n`);
    put(`zr_lh_${x}.ddls.asddls`, `@EndUserText.label: 'Item ${prefix}'\ndefine root view entity ZR_LH_${prefix} as select from zlh_${x}\n{\n  key item_id as ItemId,\n      title   as Title\n}\n`);
    put(`zr_lh_${x}.bdef.asbdef`, `managed implementation in class zbp_r_lh_${x} unique;\nstrict ( 2 );\n\ndefine behavior for ZR_LH_${prefix} alias Item\npersistent table zlh_${x}\nlock master\nauthorization master ( instance )\n{\n  create;\n  update;\n  delete;\n  determination setTitle on modify { create; }\n}\n`);
    put(`zbp_r_lh_${x}.clas.abap`, `CLASS zbp_r_lh_${x} DEFINITION PUBLIC ABSTRACT FINAL FOR BEHAVIOR OF zr_lh_${x}.\nENDCLASS.\n\nCLASS zbp_r_lh_${x} IMPLEMENTATION.\nENDCLASS.\n`);
    put(`zbp_r_lh_${x}.clas.locals_imp.abap`, `CLASS lcl_prefix DEFINITION.\n  PUBLIC SECTION.\n    CLASS-METHODS get RETURNING VALUE(rv) TYPE string.\nENDCLASS.\n\nCLASS lcl_prefix IMPLEMENTATION.\n  METHOD get.\n    rv = '${prefix}'.\n  ENDMETHOD.\nENDCLASS.\n\nCLASS lhc_item DEFINITION INHERITING FROM cl_abap_behavior_handler.\n  PRIVATE SECTION.\n    METHODS get_instance_authorizations FOR INSTANCE AUTHORIZATION\n      IMPORTING keys REQUEST requested_authorizations FOR Item RESULT result.\n    METHODS settitle FOR DETERMINE ON MODIFY IMPORTING keys FOR Item~setTitle.\nENDCLASS.\n\nCLASS lhc_item IMPLEMENTATION.\n  METHOD get_instance_authorizations.\n  ENDMETHOD.\n  METHOD settitle.\n    READ ENTITIES OF zr_lh_${x} IN LOCAL MODE ENTITY Item FIELDS ( Title ) WITH CORRESPONDING #( keys ) RESULT DATA(lt_items).\n    MODIFY ENTITIES OF zr_lh_${x} IN LOCAL MODE ENTITY Item UPDATE FIELDS ( Title )\n      WITH VALUE #( FOR i IN lt_items ( %tky = i-%tky Title = |{ lcl_prefix=>get( ) }: { i-Title }| ) ).\n  ENDMETHOD.\nENDCLASS.\n`);
    put(`zui_lh_${x}.srvd.srvdsrv`, `define service ZUI_LH_${prefix} {\n  expose ZR_LH_${prefix} as Item;\n}\n`);
  }
  const ws = new Workspace(app, { dbFile: ':memory:', systemDir: false, lint: false }); open.push(ws);
  assert.deepEqual(ws.app.diagnostics.errors, []);
  const handlers = x => ws.app.model.bos.get(`zr_lh_${x}`).handlers.map(h => h.cls);
  assert.ok(handlers('a').length && handlers('b').length);
  assert.notDeepEqual(handlers('a'), handlers('b'));   // each BO its own lhc_item
  for (const [x, prefix] of [['a', 'A'], ['b', 'B']]) {
    const c = ws.odata.handle('POST', `/odata/zui_lh_${x}/Item`, { ItemId: '1', Title: 'one' });
    assert.equal(c.status, 201, JSON.stringify(c.body));
    const r = ws.odata.handle('GET', `/odata/zui_lh_${x}/Item('1')`);
    assert.equal(r.body.Title, `${prefix}: one`);
  }
  // pools without a clash keep their local class names
  const solo = [...ws.app.model.classes.values()].filter(c => c.localName).map(c => c.localName).sort();
  assert.deepEqual(solo, ['lcl_prefix', 'lcl_prefix', 'lhc_item', 'lhc_item']);
});

test('classic build: only the classes classic objects use (an ABAP Cloud console class next to a print form is left out)', { skip: !classicAvailable() && 'classic engine not installed', timeout: 180000 }, async () => {
  const app = tmp('rap-apf-');
  fs.cpSync(new URL('../apps/adobe-print-form', import.meta.url).pathname, app, { recursive: true, filter: s => !s.includes(`${path.sep}.rap`) });
  const out = execFileSync(process.execPath, [new URL('../bin/rap.js', import.meta.url).pathname, 'gui', app, '--build-only'], { encoding: 'utf8' });
  assert.doesNotMatch(out, /cl_fp_form_reader|ERROR/i, out);
  assert.ok(!fs.existsSync(path.join(app, '.rap', 'classic', 'app', 'zcl_po_form_output.clas.abap')), 'the cloud class is not staged');
});
