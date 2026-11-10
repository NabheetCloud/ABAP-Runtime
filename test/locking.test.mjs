// Draft locks between several users (Travel example, in-memory database).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Workspace } from '../src/server/server.js';

const ws = new Workspace(new URL('../examples/travel', import.meta.url).pathname, (process.env.RAP_DB ? { dbUrl: process.env.RAP_DB } : { dbFile: ':memory:' }));
const as = user => (m, u, b) => { try { return ws.odata.handle(m, u, b, { 'x-rap-user': user }); } catch (e) { return { status: e.status || 500, body: { error: e.message } }; } };
const alice = as('alice'), bob = as('bob');
const S = '/odata/zui_travel';
const travel = id => `${S}/Travel(TravelUUID=${id},IsActiveEntity=true)`;
const draft = id => `${S}/Travel(TravelUUID=${id},IsActiveEntity=false)`;

test('a draft locks the instance for other users until it is activated or discarded', () => {
  const id = alice('GET', `${S}/Travel?$filter=IsActiveEntity eq true&$orderby=TravelID&$top=1`).body.value[0].TravelUUID;
  assert.equal(alice('POST', `${travel(id)}/Edit`, { PreserveChanges: true }).status, 200);

  const e = bob('POST', `${travel(id)}/Edit`, { PreserveChanges: true });
  assert.equal(e.status, 409);
  assert.match(e.body.error, /locked by user ALICE/i);
  assert.equal(bob('GET', draft(id)).status, 404);                                  // alice's draft is private
  const row = bob('GET', `${travel(id)}?$expand=DraftAdministrativeData`).body;
  assert.equal(row.HasDraftEntity, true);
  assert.equal(row.DraftAdministrativeData.InProcessByUser, 'ALICE');
  assert.equal(bob('GET', `${S}/Travel?$filter=IsActiveEntity eq false`).body.value.length, 0);
  assert.notEqual(bob('POST', `${travel(id)}/acceptTravel`, {}).status, 200);     // actions are blocked too

  assert.equal(alice('DELETE', draft(id)).status, 204);                             // discard releases the lock
  assert.equal(bob('POST', `${travel(id)}/Edit`, { PreserveChanges: true }).status, 200);
  assert.equal(bob('DELETE', draft(id)).status, 204);
});

test('an expired lock: PreserveChanges keeps the other user\'s draft, otherwise it is taken over', () => {
  const id = alice('GET', `${S}/Travel?$filter=IsActiveEntity eq true&$orderby=TravelID&$top=1`).body.value[0].TravelUUID;
  alice('POST', `${travel(id)}/Edit`, { PreserveChanges: true });
  alice('PATCH', draft(id), { Description: 'alice was here' });
  process.env.RAP_DRAFT_LOCK_MINUTES = '0';
  try {
    const keep = bob('POST', `${travel(id)}/Edit`, { PreserveChanges: true });
    assert.equal(keep.status, 409);
    assert.match(keep.body.error, /unsaved changes by user ALICE/i);
    const take = bob('POST', `${travel(id)}/Edit`, { PreserveChanges: false });
    assert.equal(take.status, 200);
    assert.notEqual(take.body.Description, 'alice was here');                       // bob starts from the active data
    assert.equal(alice('GET', draft(id)).status, 404);
  } finally { delete process.env.RAP_DRAFT_LOCK_MINUTES; }
  assert.equal(bob('POST', `${draft(id)}/Activate`, {}).status, 200);
});
