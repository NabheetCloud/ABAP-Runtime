// Studio scaffolding, EDMX $metadata and UI5 (IEEE754Compatible) behaviour.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Studio } from '../src/studio/studio.js';
import { Workspace } from '../src/server/server.js';
import { generateFioriApp } from '../src/studio/fiori.js';

test('studio scaffolds a new app with agent instructions', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rap-studio-'));
  const s = new Studio(dir, { port: 4999 });
  const { name } = s.create({ name: 'demo-app' });
  assert.equal(name, 'demo-app');
  const claude = fs.readFileSync(path.join(dir, name, 'CLAUDE.md'), 'utf8');
  assert.match(claude, /bin\/rap\.js odata GET/);
  assert.match(claude, /\/a\/demo-app\/apps\//);
  assert.ok(!claude.includes('{{'));
  assert.deepEqual(s.apps().map(a => a.name), ['demo-app', 's4hana']);   // the SAP standard layer is always there
  assert.ok(!s.files(name).includes('CLAUDE.md'));                   // agent instructions are not shown as app files
  const ws = s.workspace(name);
  assert.deepEqual(ws.app.diagnostics.errors, []);
  ws.close();
  assert.equal(s.create({ name: 'demo-app' }).name, 'demo-app-2');
});

test('apps can be archived (hidden, kept), restored, and deleted only once archived', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rap-studio-arch-'));
  const s = new Studio(dir, { port: 4999 });
  try {
    const { name } = s.create({ name: 'old-app' });
    s.create({ name: 'keep-app' });
    const ws = s.workspace(name);
    assert.throws(() => s.remove(name), /Archive the app before you delete it/);   // never deleted with one step
    assert.ok(s.archive(name, true).archived);
    assert.ok(ws.removed || !s.workspaces.has(name));                               // its workspace is closed
    const listed = s.apps();
    assert.ok(listed.find(a => a.name === name).archived);
    assert.ok(!listed.find(a => a.name === 'keep-app').archived);
    assert.ok(fs.existsSync(path.join(dir, name, 'src')));                         // nothing is deleted
    assert.deepEqual(s.workspace(name).app.diagnostics.errors, []);                // it still opens
    assert.equal(s.archive(name, false).archived, null);
    assert.ok(!s.apps().find(a => a.name === name).archived);
    assert.throws(() => s.archive('s4hana', true), /cannot be archived/);
    s.archive(name, true);
    assert.deepEqual(s.remove(name), { name, deleted: true });
    assert.ok(!fs.existsSync(path.join(dir, name)));
    assert.deepEqual(s.apps().map(a => a.name), ['keep-app', 's4hana']);
  } finally { for (const w of s.workspaces.values()) w.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('after an agent run the deliverables are posted in the chat; documents are served', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rap-studio-deliv-'));
  const s = new Studio(dir, { port: 4999 });
  try {
    const { name } = s.create({ name: 'deliv-app' });
    const app = path.join(dir, name);
    const run = { status: 'done', at: new Date(Date.now() - 60000).toISOString() };
    // nothing changed in the run: no deliverables
    fs.utimesSync(path.join(app, 'src'), new Date(Date.now() - 120000), new Date(Date.now() - 120000));
    s.afterRun(name, run);
    assert.equal(s.agent(name).state.items.filter(i => i.role === 'deliverables').length, 0);
    // the agent wrote them (rap deliver): the chat shows them
    const folder = path.join(app, 'docs', '2026-11-05-x');
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(path.join(folder, 'QA_Test_Report.pdf'), '%PDF-1.4');
    fs.writeFileSync(path.join(folder, 'manifest.json'), JSON.stringify({ created: new Date().toISOString(), title: 'X', folder: 'docs/2026-11-05-x', files: ['QA_Test_Report.pdf'], atc: { after: { error: 0, warning: 0, info: 0 }, fixed: 1 }, tests: { total: 2, passed: 2, failed: 0 } }));
    s.afterRun(name, run);
    const item = s.agent(name).state.items.find(i => i.role === 'deliverables');
    assert.equal(item.status, 'done');
    assert.equal(item.auto, false);
    assert.deepEqual(item.tests, { total: 2, passed: 2, failed: 0 });
    // a stopped run posts nothing
    s.afterRun(name, { ...run, status: 'stopped' });
    assert.equal(s.agent(name).state.items.filter(i => i.role === 'deliverables').length, 1);
    // the documents are served; other files and paths are not
    const get = async p => { const res = { status: 0, headers: {}, body: '', writeHead(st, h) { this.status = st; Object.assign(this.headers, h); }, setHeader(k, v) { this.headers[k] = v; }, end(b) { this.body = String(b ?? ''); }, write() {} };
      await s.route({ method: 'GET', url: p, headers: { host: 'localhost' } }, res, ''); return res; };
    let r = await get(`/studio/api/apps/${name}/docs/2026-11-05-x/QA_Test_Report.pdf`);
    assert.equal(r.status, 200); assert.equal(r.headers['Content-Type'], 'application/pdf'); assert.equal(r.body, '%PDF-1.4');
    r = await get(`/studio/api/apps/${name}/docs/2026-11-05-x/manifest.json`);
    assert.notEqual(r.status, 200);
    // the Code tab lists the documents under docs (not the manifest)
    assert.ok(s.files(name).includes('docs/2026-11-05-x/QA_Test_Report.pdf'));
    assert.ok(!s.files(name).some(f => f.endsWith('manifest.json')));
  } finally { for (const w of s.workspaces.values()) w.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('OData V4 $metadata (EDMX) and IEEE754Compatible numbers for UI5', () => {
  const ws = new Workspace(new URL('../examples/travel', import.meta.url).pathname, { ...(process.env.RAP_DB ? { dbUrl: process.env.RAP_DB } : { dbFile: ':memory:' }), lint: false });
  const md = ws.odata.handle('GET', '/odata/zui_travel/$metadata');
  assert.match(md.headers['Content-Type'], /xml/);
  assert.match(md.body, /<EntityType Name="TravelType">/);
  assert.match(md.body, /<Action Name="acceptTravel" IsBound="true"/);
  assert.match(md.body, /Term="Common.DraftRoot"/);
  assert.match(md.body, /<PropertyRef Name="IsActiveEntity"\/>/);
  assert.match(md.body, /Term="UI.LineItem"/);
  const r = ws.odata.handle('GET', '/odata/zui_travel/Travel?$select=TotalPrice&$top=1', null, { accept: 'application/json;odata.metadata=minimal;IEEE754Compatible=true' });
  assert.equal(typeof r.body.value[0].TotalPrice, 'string');
  ws.close();
});

test('Overview Page: cards from line items and charts, analytical chart annotation, IsActiveEntity eq null', () => {
  const ws = new Workspace(new URL('../examples/travel', import.meta.url).pathname, { ...(process.env.RAP_DB ? { dbUrl: process.env.RAP_DB } : { dbFile: ':memory:' }), lint: false });
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'rap-ovp-'));
  const srv = ws.app.model.services.get('zui_travel');
  const r = generateFioriApp(out, { template: 'ovp', service: srv.name, entitySet: 'Travel', name: 'travel-ovp', uiMetadata: ws.odata.uiMetadata(srv) });
  const manifest = JSON.parse(fs.readFileSync(path.join(out, 'webapp', 'travel-ovp', 'manifest.json'), 'utf8'));
  const cards = manifest['sap.ovp'].cards;
  assert.ok(Object.values(cards).some(c => c.template === 'sap.ovp.cards.v4.list'));
  assert.ok(Object.values(cards).some(c => c.template === 'sap.ovp.cards.v4.table'));
  assert.ok(Object.values(cards).some(c => c.template === 'sap.ovp.cards.v4.charts.analytical'));
  assert.match(fs.readFileSync(path.join(out, 'webapp', 'travel-ovp', 'index.html'), 'utf8'), /ushell\/bootstrap\/sandbox\.js/);
  assert.ok(r.url);

  const md = ws.odata.handle('GET', '/odata/zui_travel/$metadata').body;
  assert.match(md, /Property="DimensionAttributes"/);
  assert.match(md, /UI.ChartMeasureRoleType\/Axis1/);
  // OVP cards read "active, or the user's own draft" as (IsActiveEntity eq false or IsActiveEntity eq null)
  const rows = ws.odata.handle('GET', '/odata/zui_travel/Travel?$filter=(IsActiveEntity eq false or IsActiveEntity eq null)').body.value;
  assert.equal(rows.length, 3);
  ws.close();
});

test('agent chat streams the code of files while Claude writes them', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rap-agent-'));
  process.env.RAP_CLAUDE_BIN = new URL('./fixtures/fake-claude.mjs', import.meta.url).pathname;
  process.env.FAKE_SPEED = '0.2';
  const { AgentSession } = await import('../src/studio/agent.js');
  const a = new AgentSession(dir, { rapBin: 'rap.js', port: 4999 });
  const live = [];
  a.subscribe(ev => { if (ev.type === 'live') live.push(ev); });
  await new Promise(resolve => a.run('build it', { onDone: resolve }));
  delete process.env.RAP_CLAUDE_BIN;
  const writes = a.state.items.filter(i => i.name === 'Write');
  assert.deepEqual(writes.map(w => w.file), ['src/ztask_a.tabl.cds', 'src/zbp_r_task.clas.locals_imp.abap']);
  assert.ok(writes.every(w => w.status === 'done' && w.code.includes('\n')));
  assert.ok(live.length > 3);                                           // partial code arrived before the file was complete
  assert.ok(live.some(l => l.code && l.code.length < writes[1].code.length && writes[1].code.startsWith(l.code)));
  assert.ok(live.every(l => !l.file || l.file.startsWith('src/')));      // never a half-streamed path
  assert.equal(a.state.items.filter(i => i.role === 'tool').length, 6);  // one item per tool call, not two
  assert.equal(a.state.items.at(-1).text, 'Done: a task table and its behavior logic (demo replay).');
  const think = a.state.items.find(i => i.role === 'thinking');
  assert.equal(think.status, 'done');
  assert.match(think.text, /status determination/);
});

test('freestyle SAPUI5 apps are components: Component.js, manifest with OData V4 model and routing, ComponentSupport', () => {
  const ws = new Workspace(new URL('../examples/travel', import.meta.url).pathname, { ...(process.env.RAP_DB ? { dbUrl: process.env.RAP_DB } : { dbFile: ':memory:' }), lint: false });
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'rap-ui5-'));
  const srv = ws.app.model.services.get('zui_travel');
  generateFioriApp(out, { template: 'freestyle', service: srv.name, entitySet: 'Travel', name: 'travel-ui5', uiMetadata: ws.odata.uiMetadata(srv) });
  const dir = path.join(out, 'webapp', 'travel-ui5');
  const read = f => fs.readFileSync(path.join(dir, f), 'utf8');
  const manifest = JSON.parse(read('manifest.json'));
  assert.equal(manifest['sap.app'].dataSources.mainService.settings.odataVersion, '4.0');
  assert.equal(manifest['sap.ui5'].models[''].dataSource, 'mainService');
  assert.deepEqual(manifest['sap.ui5'].routing.routes.map(r => r.name), ['list', 'detail']);
  assert.match(read('Component.js'), /UIComponent\.extend\("z\.travelui5\.Component"/);
  assert.match(read('index.html'), /module:sap\/ui\/core\/ComponentSupport/);
  assert.doesNotMatch(read('index.html'), /ODataModel|XMLView/);                         // no models or views in index.html
  assert.match(read('view/List.view.xml'), /path: '\/Travel', filters: \[\{ path: 'IsActiveEntity'/);
  assert.match(read('view/Detail.view.xml'), /items="\{_Booking\}"/);                    // composition child table
  assert.match(read('view/Detail.view.xml'), /value="acceptTravel"/);                    // action button
  assert.match(read('controller/Detail.controller.js'), /com\.sap\.gateway\.srvd\.zui_travel\.v0001\./);
  ws.close();
});

test('apps kept from the chat (GenUI5): listed on the studio home with their URLs; GenUI5 not running is no error', async () => {
  const http = await import('node:http');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rap-studio-kept-'));
  const g5 = http.createServer((req, res) => {
    res.writeHead(req.url === '/genui/apps' ? 200 : 404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ apps: [
      { id: 'orders-to-approve-ab12', title: 'Orders to approve', created: '2026-11-13T10:00:00.000Z', service: 'po' },
      { id: '../evil', title: 'Bad id' },
      { id: 'no-title-1234', title: { x: 1 } },
    ] }));
  });
  await new Promise(r => g5.listen(0, '127.0.0.1', r));
  try {
    const s = new Studio(dir, { port: 4999, genuiUrl: `http://127.0.0.1:${g5.address().port}/genui` });
    const r = await s.chatApps();
    assert.equal(r.available, true);
    assert.equal(r.launchpad, `http://127.0.0.1:${g5.address().port}/genui/apps/`);
    assert.deepEqual(r.apps, [{ id: 'orders-to-approve-ab12', title: 'Orders to approve', created: '2026-11-13T10:00:00.000Z', url: `http://127.0.0.1:${g5.address().port}/genui/apps/orders-to-approve-ab12/` }]);
    g5.close();
    const off = await new Studio(dir, { port: 4999, genuiUrl: 'http://127.0.0.1:9/genui' }).chatApps();
    assert.deepEqual(off, { available: false, apps: [] });
  } finally { g5.close(); }
});
