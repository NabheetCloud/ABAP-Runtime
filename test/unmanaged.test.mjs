// Unmanaged business object: the application's handlers keep the buffer, its saver writes the legacy table.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Workspace } from '../src/server/server.js';

const ws = new Workspace(new URL('./fixtures/unmanaged', import.meta.url).pathname, { ...(process.env.RAP_DB ? { dbUrl: process.env.RAP_DB } : { dbFile: ':memory:' }), systemDir: false });
const call = (m, u, b, h) => { try { return ws.odata.handle(m, u, b, h); } catch (e) { return { status: e.status || 500, body: { error: e.message } }; } };
const S = '/odata/zui_legacyorder';

test('unmanaged BO activates', () => assert.deepEqual(ws.app.diagnostics.errors, []));

test('create, update, action and delete go through the handlers and the saver', () => {
  const c = call('POST', `${S}/LegacyOrder`, { Customer: 'Globex', Amount: 250 });
  assert.equal(c.status, 201, JSON.stringify(c.body));
  assert.equal(c.body.OrderNo, '00000002');                                   // numbered by the create handler
  assert.equal(c.body.Status, 'O');
  const url = `${S}/LegacyOrder('00000002')`;
  const u = call('PATCH', url, { Amount: 300 });
  assert.equal(u.status, 200, JSON.stringify(u.body));
  assert.equal(u.body.Amount, 300);
  const a = call('POST', `${url}/com.sap.gateway.srvd.zui_legacyorder.v0001.close`, {});
  assert.equal(a.status, 200, JSON.stringify(a.body));
  assert.equal(a.body.Status, 'C');
  assert.equal(a.body.Amount, 0);
  // business event raised in the saver, published after the commit
  const ev = ws.odata.rap.events();
  assert.equal(ev[0].event, 'closed');
  assert.equal(ev[0].payload[0].orderno, '00000002');
  assert.equal(ws.app.db.prepare('SELECT note FROM zorder_log').get().note, 'closed, notify accounting');   // event handler ran
  assert.equal(call('DELETE', url).status, 204);
  assert.equal(call('GET', url).status, 404);
  assert.equal(call('GET', `${S}/LegacyOrder`).body.value.length, 1);
});

test('check_before_save rejects; the buffer is cleaned up; readonly and etag still apply', () => {
  const bad = call('POST', `${S}/LegacyOrder`, { Amount: 5 });
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /Customer/);
  assert.equal(call('GET', `${S}/LegacyOrder`).body.value.length, 1);
  assert.equal(call('PATCH', `${S}/LegacyOrder('00000001')`, { Status: 'X' }).status, 400);           // readonly
  assert.equal(call('PATCH', `${S}/LegacyOrder('00000001')`, { Amount: 1 }, { 'if-match': 'W/"1"' }).status, 412);
  const ok = call('POST', `${S}/LegacyOrder`, { Customer: 'Initech' });
  assert.equal(ok.body.OrderNo, '00000002');                                   // nothing left over from the failed request
});

test('dynamic EML: MODIFY / READ ENTITIES OPERATIONS', () => {
  ws.odata.handle('GET', `${S}/LegacyOrder`);
  assert.equal(ws.app.rt.cls('zcl_order_dyn').rename({ iv_order: '00000001', iv_customer: 'Umbrella' }).rv_customer, 'Umbrella');
  assert.equal(call('GET', `${S}/LegacyOrder('00000001')`).body.Customer, 'Umbrella');
});
