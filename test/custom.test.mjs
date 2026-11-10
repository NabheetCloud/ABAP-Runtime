// Custom entities: data from an ABAP class implementing if_rap_query_provider (filter, paging, sorting, count).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Workspace } from '../src/server/server.js';

const ws = new Workspace(new URL('./fixtures/custom', import.meta.url).pathname, { ...(process.env.RAP_DB ? { dbUrl: process.env.RAP_DB } : { dbFile: ':memory:' }), systemDir: false });
const call = (m, u, b) => { try { return ws.odata.handle(m, u, b); } catch (e) { return { status: e.status || 500, body: { error: e.message } }; } };
const S = '/odata/zui_flight';

test('custom entity activates', () => assert.deepEqual(ws.app.diagnostics.errors, []));

test('query class serves filter, sorting, paging and count', () => {
  const all = call('GET', `${S}/Flight?$count=true`);
  assert.equal(all.status, 200, JSON.stringify(all.body));
  assert.equal(all.body['@odata.count'], 4);
  assert.deepEqual(all.body.value.map(f => f.CarrierId), ['AA', 'LH', 'LH', 'UA']);
  assert.equal(all.body.value[1].PriceClass, 'Premium');                         // computed in ABAP
  const ny = call('GET', `${S}/Flight?$filter=CityFrom eq 'New York'&$orderby=Price desc&$count=true`);
  assert.deepEqual(ny.body.value.map(f => f.Price), [650, 420]);
  assert.equal(ny.body['@odata.count'], 2);
  const page = call('GET', `${S}/Flight?$top=2&$skip=1`);
  assert.deepEqual(page.body.value.map(f => f.ConnectionId), ['0400', '0401']);
  const one = call('GET', `${S}/Flight(CarrierId='UA',ConnectionId='0941')`);
  assert.equal(one.body.CityFrom, 'San Francisco');
  assert.match(call('GET', `${S}/$metadata`).body, /EntitySet Name="Flight"/);
});

test('views with parameters: path or query option, defaults from system fields, bound in other views', () => {
  const r = call('GET', `${S}/FlightByCity(p_city='New York')/Set?$orderby=Price`);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.value.map(f => f.CarrierId), ['AA', 'LH']);
  assert.match(String(r.body.value[0].KeyDate), /^\d{4}-\d{2}-\d{2}$/);                    // #SYSTEM_DATE default
  assert.equal(call('GET', `${S}/FlightByCity?p_city='Frankfurt'`).body.value.length, 1);
  assert.equal(call('GET', `${S}/FlightByCity`).status, 400);                              // p_city has no default
  assert.equal(call('GET', `${S}/NYFlight`).body.value.length, 2);
});

test('table function implemented in SQLScript (AMDP), with a parameter', () => {
  const r = call('GET', `${S}/CarrierRevenue(p_min=500)/Set?$orderby=carrier_id`);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.value.map(x => [x.carrier_id, x.total]), [['LH', 1250]]);
  assert.equal(call('GET', `${S}/CarrierRevenue?p_min=0`).body.value.length, 3);
});

test('ABAP SQL on views and table functions with parameters', () => {
  const C = ws.app.rt.cls('zcl_flight_tf');
  assert.equal(C.ny_count({}).rv_count, 2);
  assert.equal(C.big_carriers({}).rv_count, 1);
});

test('ABAP Unit: test classes, SQL test double, test seam injection; data is restored', () => {
  const r = ws.runTests();
  const by = Object.fromEntries(r.results.map(t => [t.method, t]));
  assert.equal(by.discount_default.status, 'passed', by.discount_default.message);
  assert.equal(by.discount_injected.status, 'passed', by.discount_injected.message);
  assert.equal(by.demo_failure.status, 'failed');
  assert.match(by.demo_failure.message, /Expected \[1\] Actual \[360\]: deliberately wrong/);
  assert.equal(ws.app.db.prepare('SELECT COUNT(*) AS n FROM zflight_a').get().n, 4);
});
