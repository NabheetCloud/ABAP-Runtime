// Code intelligence of the studio editor (src/server/codeintel.js): completion, go to definition, where-used,
// rename, hover and outline on the travel example.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Workspace } from '../src/server/server.js';
import { CodeIntel } from '../src/server/codeintel.js';

const SRC = new URL('../examples/travel', import.meta.url).pathname;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rap-ci-'));
fs.cpSync(SRC, dir, { recursive: true, filter: f => !f.includes(`${path.sep}.rap`) });
fs.writeFileSync(path.join(dir, 'src/zcl_ci_demo.clas.abap'), `CLASS zcl_ci_demo DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-METHODS greet IMPORTING iv_name TYPE string RETURNING VALUE(rv_text) TYPE string.
ENDCLASS.

CLASS zcl_ci_demo IMPLEMENTATION.
  METHOD greet.
    rv_text = |Hello { iv_name }|.
  ENDMETHOD.
ENDCLASS.
`);
const ws = new Workspace(dir, { systemDir: false, lint: false, dbFile: ':memory:' });
const ci = new CodeIntel(ws);
after(() => { ws.close(); fs.rmSync(dir, { recursive: true, force: true }); });
const read = f => fs.readFileSync(path.join(dir, f), 'utf8');

test('completion: fields after alias~, columns of a table, methods after =>, annotations, keywords and snippets', () => {
  const t = 'SELECT FROM ztravel_a AS t FIELDS t~';
  const items = ci.complete({ file: 'src/x.clas.abap', text: t, line: 1, col: t.length + 1 }).items.map(i => i.label);
  assert.ok(items.includes('travel_id') && items.includes('customer_id'), items.join(','));
  const d = 'DATA ls_t TYPE ztravel_a.\nls_t-';
  assert.ok(ci.complete({ file: 'src/x.clas.abap', text: d, line: 2, col: 6 }).items.some(i => i.label === 'total_price'));
  const v = 'define view entity ZX as select from ZR_Travel { _Customer. }';
  const vi = ci.complete({ file: 'src/zx.ddls.asddls', text: 'define view entity ZX as select from ZR_Travel\n{ ZR_Travel.', line: 2, col: 13 }).items.map(i => i.label);
  void v; assert.ok(vi.includes('TravelID'), vi.slice(0, 20).join(','));
  const an = ci.complete({ file: 'src/zx.ddlx.asddlxs', text: '@UI.line', line: 1, col: 9 }).items;
  assert.ok(an.some(i => i.label === '@UI.lineItem'));
  const all = ci.complete({ file: 'src/x.clas.abap', text: 'LO', line: 1, col: 3 }).items;
  assert.ok(all.some(i => i.label === 'LOOP AT') && all.some(i => i.kind === 'snippet' && i.label === 'readentities'));
  assert.ok(all.some(i => i.label === 'zr_travel') && all.some(i => /^I_Customer$/i.test(i.label)), 'app objects and the SAP standard layer');
});

test('go to definition: an object, a class method, a local variable, a standard view (read-only)', () => {
  assert.deepEqual(ci.definition({ file: 'src/x.abap', text: 'zr_travel', line: 1, col: 3 }), { file: 'src/zr_travel.ddls.asddls', line: read('src/zr_travel.ddls.asddls').split('\n').findIndex(l => /define root view entity/i.test(l)) + 1 });
  const cls = read('src/zcl_ci_demo.clas.abap');
  const call = 'zcl_ci_demo=>greet';
  const loc = ci.definition({ file: 'src/x.abap', text: call, line: 1, col: call.length });
  assert.equal(loc.file, 'src/zcl_ci_demo.clas.abap');
  assert.match(cls.split('\n')[loc.line - 1], /METHOD greet\./i);
  const items = ci.complete({ file: 'src/x.abap', text: 'zcl_ci_demo=>', line: 1, col: 14 }).items.map(i => i.label);
  assert.ok(items.includes('greet'), items.join(','));
  const local = 'DATA lv_x TYPE i.\nlv_x = 1.';
  assert.deepEqual(ci.definition({ file: 'src/x.abap', text: local, line: 2, col: 2 }), { file: 'src/x.abap', line: 1 });
  const std = ci.definition({ file: 'src/x.abap', text: 'i_customer', line: 1, col: 3 });
  assert.equal(std.readOnly, true);
  assert.match(std.text, /I_Customer/i);
});

test('where-used of an entity; hover; outline', () => {
  const refs = ci.whereUsed('ZR_Travel');
  const files = new Set(refs.map(r => r.file));
  assert.ok(files.has('src/zr_travel.bdef.asbdef') && files.has('src/zc_travel.ddls.asddls'), [...files].join(','));
  const h = ci.hover({ file: 'src/x.abap', text: 'ztravel_a', line: 1, col: 3 });
  assert.match(h.title, /Table ZTRAVEL_A/);
  assert.match(h.text, /travel_id/);
  const syms = ci.symbols(read('src/zbp_r_travel.clas.locals_imp.abap'), 'src/zbp_r_travel.clas.locals_imp.abap');
  assert.ok(syms.some(s => s.kind === 'class') && syms.some(s => s.kind === 'method'));
  assert.ok(ci.symbols(read('src/zr_travel.bdef.asbdef'), 'src/zr_travel.bdef.asbdef').some(s => s.kind === 'action'));
});

test('rename a class: preview, then files and references change and the app activates with 0 errors', () => {
  const prev = ci.rename({ name: 'zcl_travel_console', newName: 'zcl_trip_console' });
  assert.ok(prev.changes.length >= 1 && prev.moves.some(m => m.to === 'src/zcl_trip_console.clas.abap'));
  assert.ok(fs.existsSync(path.join(dir, 'src/zcl_travel_console.clas.abap')), 'the preview changes nothing');
  ci.rename({ name: 'zcl_travel_console', newName: 'zcl_trip_console', apply: true });
  assert.ok(fs.existsSync(path.join(dir, 'src/zcl_trip_console.clas.abap')));
  assert.match(read('src/zcl_trip_console.clas.abap'), /CLASS zcl_trip_console DEFINITION/i);
  ws.activate();
  assert.deepEqual(ws.app.diagnostics.errors, []);
  assert.throws(() => ci.rename({ name: 'zcl_trip_console', newName: 'zr_travel' }), /exists already/);
});

test('over HTTP in the studio: /api/codeintel/complete, definition, whereused, hover, symbols', async () => {
  const { Studio } = await import('../src/studio/studio.js');
  const apps = fs.mkdtempSync(path.join(os.tmpdir(), 'rap-ci-apps-'));
  fs.cpSync(SRC, path.join(apps, 'demo'), { recursive: true, filter: f => !f.includes(`${path.sep}.rap`) });
  const s = new Studio(apps, { port: 0 });
  const server = s.listen();
  await new Promise(r => (server.listening ? r() : server.once('listening', r)));
  const base = `http://127.0.0.1:${server.address().port}/a/demo/api/codeintel`;
  const post = async (op, b) => (await fetch(`${base}/${op}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) })).json();
  try {
    const t = 'SELECT FROM ztravel_a AS t FIELDS t~';
    assert.ok((await post('complete', { file: 'src/x.clas.abap', text: t, line: 1, col: t.length + 1 })).items.some(i => i.label === 'travel_id'));
    assert.equal((await post('definition', { file: 'src/x.abap', text: 'zr_travel', line: 1, col: 3 })).location.file, 'src/zr_travel.ddls.asddls');
    assert.ok((await post('whereused', { name: 'ZR_Travel' })).refs.length > 3);
    assert.match((await post('hover', { file: 'src/x.abap', text: 'ztravel_a', line: 1, col: 3 })).hover.title, /ZTRAVEL_A/);
    assert.ok((await post('symbols', { file: 'src/zr_travel.bdef.asbdef' })).symbols.length > 0, 'the saved source when no text is sent');
  } finally { server.close(); fs.rmSync(apps, { recursive: true, force: true }); }
});
