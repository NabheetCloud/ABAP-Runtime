// Visual editors (src/ui/studio/visual/models.js): every table, view entity, behavior definition and metadata
// extension of the examples survives parse -> write unchanged in meaning (the apps still activate), typical edits
// made in the editors activate and behave, and classic screens keep their XML.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as M from '../src/ui/studio/visual/models.js';
import { designable, roundTrip } from './visual-rt.mjs';
import { Workspace } from '../src/server/server.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rap-visual-'));
const open = [];
after(() => { for (const w of open) w.close(); fs.rmSync(tmp, { recursive: true, force: true }); });
const copy = name => { const d = path.join(tmp, name); fs.cpSync(new URL(`../examples/${name}`, import.meta.url).pathname, d, { recursive: true, filter: f => !f.includes(`${path.sep}.rap`) }); return d; };
const ws = d => { const w = new Workspace(d, { systemDir: false, lint: false, dbFile: ':memory:' }); open.push(w); return w; };

test('every designable source of the examples round-trips (parse -> write -> parse is stable)', () => {
  const files = designable(new URL('../examples', import.meta.url).pathname);
  assert.ok(files.length > 30);
  for (const f of files) { const r = roundTrip(f); if (!r.skipped) assert.ok(r.same, f); }
});

test('the travel and orders apps activate after every source was rewritten by the editors', () => {
  for (const app of ['travel', 'orders']) {
    const d = copy(app);
    const before = ws(d).app.diagnostics.errors.length;
    for (const f of designable(d)) { const r = roundTrip(f); if (!r.skipped) fs.writeFileSync(f, r.out); }
    const w = ws(d);
    assert.equal(w.app.diagnostics.errors.length, before, `${app}: ${JSON.stringify(w.app.diagnostics.errors.slice(0, 3))}`);
  }
});

test('typical edits: a table field, the view element, a BDEF action and the Fiori column activate and run', () => {
  const d = copy('travel');
  const src = f => path.join(d, 'src', f);
  const t = M.parseTable(fs.readFileSync(src('ztravel_a.tabl.cds'), 'utf8'));
  t.fields.splice(t.fields.findIndex(f => f.name === 'reject_reason') + 1, 0, { key: false, name: 'priority', type: 'char', builtin: true, length: 1, decimals: null, notNull: false, anns: {} });
  assert.deepEqual(M.checkTable(t), []);
  fs.writeFileSync(src('ztravel_a.tabl.cds'), M.writeTable(t));
  const dr = M.parseTable(fs.readFileSync(src('ztravel_d.tabl.cds'), 'utf8'));
  dr.fields.splice(dr.fields.findIndex(f => f.name === 'rejectreason') + 1, 0, { key: false, name: 'priority', type: 'char', builtin: true, length: 1, decimals: null, notNull: false, anns: {} });
  fs.writeFileSync(src('ztravel_d.tabl.cds'), M.writeTable(dr));
  const v = M.parseView(fs.readFileSync(src('zr_travel.ddls.asddls'), 'utf8'));
  v.elements.splice(v.elements.findIndex(e => e.alias === 'RejectReason') + 1, 0, { key: false, expr: 'priority', alias: 'Priority', anns: {} });
  fs.writeFileSync(src('zr_travel.ddls.asddls'), M.writeView(v));
  const c = M.parseView(fs.readFileSync(src('zc_travel.ddls.asddls'), 'utf8'));
  c.elements.splice(c.elements.findIndex(e => e.expr === 'RejectReason') + 1, 0, { key: false, expr: 'Priority', alias: '', anns: {} });
  fs.writeFileSync(src('zc_travel.ddls.asddls'), M.writeView(c));
  const b = M.parseBdef(fs.readFileSync(src('zr_travel.bdef.asbdef'), 'utf8'));
  const tr = b.entities[0];
  tr.items.find(x => x.k === 'mapping').pairs.push(['Priority', 'priority']);
  fs.writeFileSync(src('zr_travel.bdef.asbdef'), M.writeBdef(b));
  const x = M.parseDdlx(fs.readFileSync(src('zc_travel.ddlx.asddlxs'), 'utf8'));
  x.elements.push({ name: 'Priority', anns: { 'UI.lineItem': [{ position: 80 }], 'UI.identification': [{ position: 80 }], 'EndUserText.label': 'Priority' } });
  fs.writeFileSync(src('zc_travel.ddlx.asddlxs'), M.writeDdlx(x));
  const w = ws(d);
  assert.deepEqual(w.app.diagnostics.errors, []);
  const r = w.odata.handle('GET', '/odata/zui_travel/Travel?$top=1&$select=TravelID,Priority', null, {});
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.ok('Priority' in r.body.value[0]);
  assert.match(w.odata.handle('GET', '/odata/zui_travel/$metadata', null, {}).body, /Priority/);
});

test('classic screens: the DYNPROS of a module pool round-trip; a new input field and the flow logic are written', () => {
  const xml = fs.readFileSync(new URL('../examples/classic/src/zcflight_maint.prog.xml', import.meta.url), 'utf8');
  const s = M.parseScreens(xml);
  assert.equal(s.screens[0].fields.length, 9);
  assert.equal(M.writeScreens(xml, s), xml);
  s.screens[0].fields.push({ type: 'TEXT', name: 'LBL_NOTE', text: 'Note', line: 5, column: 1, length: 14, format: 'CHAR', input: false, output: false },
    { type: 'TEMPLATE', name: 'GV_NOTE', text: '', line: 5, column: 16, length: 30, format: 'CHAR', input: true, output: true });
  const out = M.writeScreens(xml, s);
  assert.match(out, /<NAME>GV_NOTE<\/NAME>\s*<TEXT>_{30}<\/TEXT>\s*<LINE>005<\/LINE>/);
  assert.equal(M.parseScreens(out).screens[0].fields.length, 11);
  const flow = M.parseFlow(fs.readFileSync(new URL('../examples/classic/src/zcflight_maint.prog.screen_0100.abap', import.meta.url), 'utf8'));
  assert.deepEqual(flow.pai.map(m => m.name), ['exit_0100', 'user_command_0100']);
  assert.equal(M.writeFlow(flow), fs.readFileSync(new URL('../examples/classic/src/zcflight_maint.prog.screen_0100.abap', import.meta.url), 'utf8').replace(/\n*$/, '\n'));
});
