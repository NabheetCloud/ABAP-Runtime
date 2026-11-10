// End-to-end tests of the Travel example through the OData layer (in-memory database).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Workspace } from '../src/server/server.js';

const ws = new Workspace(new URL('../examples/travel', import.meta.url).pathname, (process.env.RAP_DB ? { dbUrl: process.env.RAP_DB } : { dbFile: ':memory:' }));
const call = (m, u, b) => { try { return ws.odata.handle(m, u, b); } catch (e) { return { status: e.status || 500, body: { error: e.message, details: e.details } }; } };
const S = '/odata/zui_travel';

test('workspace activates without errors (incl. abaplint syntax check)', () => {
  assert.deepEqual(ws.app.diagnostics.errors, []);
});

test('read through projection with association path and calculated fields', () => {
  const r = call('GET', `${S}/Travel?$orderby=TravelID&$count=true&$filter=IsActiveEntity eq true`);
  assert.equal(r.status, 200);
  assert.equal(r.body['@odata.count'], 3);
  assert.equal(r.body.value[0].CustomerName, 'Theresia Buchholm');
  assert.equal(r.body.value[2].StatusText, 'Rejected');
});

test('draft: validations run on activation, not while editing', () => {
  const c = call('POST', `${S}/Travel`, { CustomerID: '999999', BeginDate: '2027-05-10', EndDate: '2027-05-01', CurrencyCode: 'EUR' });
  assert.equal(c.status, 201);
  assert.equal(c.body.IsActiveEntity, false);                      // created as draft
  const r = call('POST', `${S}/Travel(TravelUUID=${c.body.TravelUUID},IsActiveEntity=false)/Activate`, {});
  assert.equal(r.status, 400);
  const texts = r.body.details.map(d => d.text);
  assert.ok(texts.includes('Customer 999999 does not exist'));
  assert.ok(texts.some(t => t.startsWith('End date 2027-05-01')));
  assert.equal(call('DELETE', `${S}/Travel(TravelUUID=${c.body.TravelUUID},IsActiveEntity=false)`).status, 204); // discard
});

test('draft: create, child create, activate, edit, discard, actions, feature control', () => {
  const c = call('POST', `${S}/Travel`, { CustomerID: '000006', Description: 'Test', BeginDate: '2027-06-01', EndDate: '2027-06-05', BookingFee: 15, CurrencyCode: 'EUR' });
  assert.equal(c.status, 201);
  assert.equal(c.body.OverallStatus, 'O');            // determination on modify runs in the draft
  const id = c.body.TravelUUID;
  const draft = `${S}/Travel(TravelUUID=${id},IsActiveEntity=false)`;
  const b = call('POST', `${draft}/_Booking`, { CarrierID: 'AI', FlightDate: '2027-06-01', FlightPrice: 100.5 });
  assert.equal(b.status, 201);
  assert.equal(b.body.BookingID, '0001');
  assert.equal(b.body.CurrencyCode, 'EUR');           // defaulted from the draft parent
  assert.equal(call('GET', draft).body.TotalPrice, 115.5); // internal action + REDUCE on draft data
  assert.equal(call('PATCH', draft, { TotalPrice: 1 }).status, 400); // read-only field
  const a = call('POST', `${draft}/Activate`, {});
  assert.equal(a.status, 200);
  assert.equal(a.body.IsActiveEntity, true);
  assert.equal(a.body.TravelID, '00000004');          // determination on save at activation
  const active = `${S}/Travel(TravelUUID=${id},IsActiveEntity=true)`;
  assert.equal(call('GET', `${active}/_Booking`).body.value.length, 1);
  assert.equal(call('PATCH', active, { Description: 'x' }).status, 400); // draft BO: change via Edit only
  const e = call('POST', `${active}/Edit`, { PreserveChanges: true });
  assert.equal(e.body.IsActiveEntity, false);
  call('PATCH', draft, { Description: 'changed in draft' });
  assert.equal(call('GET', active).body.HasDraftEntity, true);
  assert.equal(call('DELETE', draft).status, 204);    // discard
  assert.equal(call('GET', active).body.Description, 'Test');
  assert.equal(call('POST', `${active}/rejectTravel`, {}).status, 400); // action parameter check
  const acc = call('POST', `${active}/acceptTravel`, {});
  assert.equal(acc.body.OverallStatus, 'A');
  const f = call('GET', `${active}/$features`).body;
  assert.equal(f.update, false);
  assert.equal(f.actions.acceptTravel, false);
  assert.equal(call('DELETE', active).status, 400);
});

test('$batch change set with Content-ID reference and $apply aggregation', () => {
  const b = 'batch_1';
  const raw = [`--${b}`, 'Content-Type: multipart/mixed; boundary=cs_1', '', '--cs_1', 'Content-Type: application/http', 'Content-Transfer-Encoding: binary', 'Content-ID: 1', '',
    'POST Travel HTTP/1.1', 'Content-Type: application/json', '', JSON.stringify({ CustomerID: '000001', BeginDate: '2027-07-01', EndDate: '2027-07-02', CurrencyCode: 'EUR' }),
    '--cs_1', 'Content-Type: application/http', 'Content-Transfer-Encoding: binary', 'Content-ID: 2', '', 'POST $1/_Booking HTTP/1.1', 'Content-Type: application/json', '', JSON.stringify({ CarrierID: 'AA', FlightDate: '2027-07-01', FlightPrice: 50 }),
    '--cs_1--', `--${b}--`, ''].join('\r\n');
  const r = ws.odata.batch(raw, { 'content-type': `multipart/mixed; boundary=${b}` }, '/odata/zui_travel/$batch');
  assert.equal(r.status, 200);
  assert.equal((r.body.match(/HTTP\/1\.1 201 Created/g) || []).length, 2);
  const agg = call('GET', `${S}/Travel?$apply=filter(IsActiveEntity eq true)/groupby((CurrencyCode),aggregate(TotalPrice with sum as Total,$count as Cnt))`);
  assert.ok(agg.body.value.some(v => v.CurrencyCode === 'EUR' && v.Cnt >= 2));
});

test('console class with EML and ABAP SQL', () => {
  const r = ws.runClass('zcl_travel_console');
  assert.ok(r.ok, r.error);
  assert.match(r.output, /After acceptTravel: status A/);
});

test('a console run and the job scheduler share the app RAP runtime: EML in handlers keeps working through OData', () => {
  // each of them used to create its own RAP runtime, which took over rt.eml: actions then changed a transaction that
  // was never saved and validations read nothing, while the OData request saw success
  ws.runClass('zcl_travel_console');
  ws.runDueJobs();
  const c = call('POST', `${S}/Travel`, { CustomerID: '999999', BeginDate: '2027-05-10', EndDate: '2027-05-01', CurrencyCode: 'EUR' });
  const r = call('POST', `${S}/Travel(TravelUUID=${c.body.TravelUUID},IsActiveEntity=false)/Activate`, {});
  assert.equal(r.status, 400, 'validations still run');
  call('DELETE', `${S}/Travel(TravelUUID=${c.body.TravelUUID},IsActiveEntity=false)`);
  const open = call('GET', `${S}/Travel?$filter=IsActiveEntity eq true and OverallStatus eq 'O'&$top=1`).body.value[0];
  ws.runDueJobs();
  const path = `${S}/Travel(TravelUUID=${open.TravelUUID},IsActiveEntity=true)`;
  assert.equal(call('POST', `${path}/acceptTravel`, {}).body.OverallStatus, 'A');
  assert.equal(call('GET', path).body.OverallStatus, 'A', 'the action saved its change');
});
