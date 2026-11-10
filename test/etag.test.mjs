// Optimistic locking: etag master (If-Match / 412) and total etag (draft activation after a concurrent change).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Workspace } from '../src/server/server.js';

const ws = new Workspace(new URL('../examples/travel', import.meta.url).pathname, (process.env.RAP_DB ? { dbUrl: process.env.RAP_DB } : { dbFile: ':memory:' }));
const call = (m, u, b, h = {}) => { try { return ws.odata.handle(m, u, b, h); } catch (e) { return { status: e.status || 500, body: { error: e.message } }; } };
const S = '/odata/zui_travel';

test('entities carry @odata.etag, $metadata declares optimistic concurrency', () => {
  const r = call('GET', `${S}/Travel?$top=1&$filter=IsActiveEntity eq true`);
  assert.match(r.body.value[0]['@odata.etag'], /^W\/"/);
  assert.match(call('GET', `${S}/$metadata`).body, /Core.OptimisticConcurrency/);
});

test('If-Match with an outdated etag is rejected with 412; the current etag passes', () => {
  const t = call('GET', `${S}/Travel?$top=1&$filter=IsActiveEntity eq true`).body.value[0];
  const url = `${S}/Travel(TravelUUID=${t.TravelUUID},IsActiveEntity=true)`;
  assert.equal(call('POST', `${url}/Edit`, { PreserveChanges: true }, { 'if-match': 'W/"19990101000000"' }).status, 412);
  const ok = call('POST', `${url}/Edit`, { PreserveChanges: true }, { 'if-match': t['@odata.etag'] });
  assert.equal(ok.status, 200);
  assert.equal(call('DELETE', `${S}/Travel(TravelUUID=${t.TravelUUID},IsActiveEntity=false)`).status, 204);
});

test('total etag: activating a draft fails when the active instance changed after the draft was created', () => {
  const t = call('GET', `${S}/Travel?$top=1&$skip=1&$filter=IsActiveEntity eq true`).body.value[0];
  const url = `${S}/Travel(TravelUUID=${t.TravelUUID},IsActiveEntity=true)`;
  assert.equal(call('POST', `${url}/Edit`, { PreserveChanges: true }).status, 200);
  ws.app.db.exec(`UPDATE ztravel_a SET last_changed_at = 20991231235959`);   // someone else saved meanwhile
  const draft = `${S}/Travel(TravelUUID=${t.TravelUUID},IsActiveEntity=false)`;
  const r = call('POST', `${draft}/Activate`, {});
  assert.equal(r.status, 409);
  assert.match(r.body.error, /changed by another user/);
  assert.equal(call('DELETE', draft).status, 204);
});
