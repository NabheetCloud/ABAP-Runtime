// OData V2 (SAP Gateway style) on the Travel example: the same RAP service as V4, translated (odata-v2.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Workspace } from '../src/server/server.js';

const ws = new Workspace(new URL('../examples/travel', import.meta.url).pathname, (process.env.RAP_DB ? { dbUrl: process.env.RAP_DB } : { dbFile: ':memory:' }));
const call = (m, u, b, h = {}) => ws.odatav2.handle(m, `ZUI_TRAVEL/${u}`, b, h);
const ACTIVE = "IsActiveEntity=true";

test('service document and $metadata (EDMX 1.0 with sap: annotations)', () => {
  assert.deepEqual(call('GET', '').body.d.EntitySets, ['Travel', 'Booking', 'Customer', 'TravelAnalytics']);
  const x = call('GET', '$metadata').body;
  assert.match(x, /<edmx:Edmx Version="1\.0"/);
  assert.match(x, /m:DataServiceVersion="2\.0"/);
  assert.match(x, /<EntityType Name="TravelType" sap:label="Travel - Projection"/);
  assert.match(x, /<Property Name="BeginDate" Type="Edm\.DateTime" Precision="0" sap:display-format="Date"/);
  assert.match(x, /<Property Name="TotalPrice" Type="Edm\.Decimal" Precision="16" Scale="2"[^>]*sap:unit="CurrencyCode"/);
  assert.match(x, /<NavigationProperty Name="_Booking" Relationship="ZUI_TRAVEL_SRV\.assoc_Travel__Booking"/);
  assert.match(x, /<FunctionImport Name="acceptTravel" ReturnType="ZUI_TRAVEL_SRV\.TravelType" EntitySet="Travel" m:HttpMethod="POST"/);
  assert.match(x, /<FunctionImport Name="TravelActivate"/);
  assert.match(x, /<EntitySet Name="Travel" EntityType="ZUI_TRAVEL_SRV\.TravelType" sap:creatable="true"/);
});

test('read: $inlinecount, V2 literals in keys and $filter, /Date()/ values, $expand and __deferred', () => {
  const r = call('GET', `Travel?$inlinecount=allpages&$orderby=TravelID&$filter=IsActiveEntity eq true and substringof('Walldorf',Description)`);
  assert.equal(r.status, 200);
  assert.equal(r.body.d.__count, '1');
  const t = r.body.d.results[0];
  assert.equal(t.Description, 'Business trip to Walldorf');
  assert.match(t.BeginDate, /^\/Date\(\d+\)\/$/);
  assert.equal(typeof t.TotalPrice, 'string');                                  // Edm.Decimal as string
  assert.equal(t.__metadata.type, 'ZUI_TRAVEL_SRV.TravelType');
  assert.ok(t._Booking.__deferred.uri.endsWith('/_Booking'));
  const one = call('GET', `Travel(TravelUUID=guid'${t.TravelUUID}',${ACTIVE})?$expand=_Booking`);
  assert.equal(one.body.d.TravelID, t.TravelID);
  assert.ok(Array.isArray(one.body.d._Booking.results));
  const nav = call('GET', `Travel(TravelUUID=guid'${t.TravelUUID}',${ACTIVE})/_Booking?$inlinecount=allpages`);
  assert.equal(nav.body.d.__count, String(one.body.d._Booking.results.length));
  assert.equal(call('GET', `Travel/$count?$filter=IsActiveEntity eq true`).body, '3');
  const dated = call('GET', `Travel?$filter=IsActiveEntity eq true and BeginDate ge datetime'2027-01-01T00:00:00'&$inlinecount=allpages`);
  assert.equal(dated.status, 200);
  assert.ok(Number(dated.body.d.__count) <= 3);
});

test('draft through function imports: create, MERGE, Activate; errors in V2 format', () => {
  const c = call('POST', 'Travel', { CustomerID: '000006', Description: 'V2 trip', BeginDate: '/Date(1811808000000)/', EndDate: '/Date(1812153600000)/', BookingFee: '15.00', CurrencyCode: 'EUR' });
  assert.equal(c.status, 201, JSON.stringify(c.body));
  assert.equal(c.body.d.IsActiveEntity, false);
  assert.equal(c.body.d.OverallStatus, 'O');                                    // determination ran
  const id = c.body.d.TravelUUID;
  const draft = `Travel(TravelUUID=guid'${id}',IsActiveEntity=false)`;
  const mg = call('MERGE', draft, { Description: 'V2 trip (changed)' });
  assert.equal(mg.status, 204, JSON.stringify(mg.body));
  assert.equal(call('POST', draft, { Description: 'tunnelled' }, { 'x-http-method': 'MERGE' }).status, 204);
  assert.equal(call('GET', draft).body.d.Description, 'tunnelled');
  const bad = call('MERGE', draft, { TotalPrice: '1' });                        // read-only field
  assert.equal(bad.status, 400);
  assert.ok(bad.body.error.message.value);
  const a = call('POST', `TravelActivate?TravelUUID=guid'${id}'&IsActiveEntity=false`);
  assert.equal(a.status, 200, JSON.stringify(a.body));
  assert.equal(a.body.d.IsActiveEntity, true);
  assert.equal(a.body.d.BeginDate, '/Date(1811808000000)/');
  // bound action with a parameter
  const rej = call('POST', `rejectTravel?TravelUUID=guid'${id}'&IsActiveEntity=true&Reason='too expensive'`);
  assert.equal(rej.status, 200, JSON.stringify(rej.body));
  assert.equal(rej.body.d.OverallStatus, 'X');
  // validation errors on activation come back as a V2 error with details
  const wrong = call('POST', 'Travel', { CustomerID: '999999', BeginDate: '/Date(1811808000000)/', EndDate: '/Date(1811000000000)/', CurrencyCode: 'EUR' });
  const fail = call('POST', `TravelActivate?TravelUUID=guid'${wrong.body.d.TravelUUID}'&IsActiveEntity=false`);
  assert.equal(fail.status, 400);
  assert.ok(fail.body.error.innererror.errordetails.some(d => /999999/.test(d.message)));
  assert.equal(call('DELETE', `Travel(TravelUUID=guid'${wrong.body.d.TravelUUID}',IsActiveEntity=false)`).status, 204);
});

test('$batch: read requests and an all-or-nothing change set', () => {
  const b = 'batch_1', c = 'changeset_1';
  const t = call('GET', `Travel?$top=1&$filter=IsActiveEntity eq true`).body.d.results[0];
  const body = [
    `--${b}`, 'Content-Type: application/http', 'Content-Transfer-Encoding: binary', '', `GET Customer?$top=2&$inlinecount=allpages HTTP/1.1`, 'Accept: application/json', '', '',
    `--${b}`, `Content-Type: multipart/mixed; boundary=${c}`, '',
    `--${c}`, 'Content-Type: application/http', 'Content-Transfer-Encoding: binary', '', `POST Travel HTTP/1.1`, 'Content-Type: application/json', '',
    JSON.stringify({ CustomerID: '000006', Description: 'batch', BeginDate: '/Date(1811808000000)/', EndDate: '/Date(1812153600000)/', CurrencyCode: 'EUR' }), '',
    `--${c}`, 'Content-Type: application/http', 'Content-Transfer-Encoding: binary', '', `MERGE Travel(TravelUUID=guid'${t.TravelUUID}',IsActiveEntity=true) HTTP/1.1`, 'Content-Type: application/json', '',
    JSON.stringify({ Description: 'not allowed: draft BO changes go through Edit' }), '',
    `--${c}--`, `--${b}--`, ''].join('\r\n');
  const before = call('GET', `Travel/$count`).body;
  const r = ws.odatav2.batch(body, { 'content-type': `multipart/mixed; boundary=${b}` }, 'ZUI_TRAVEL');
  assert.equal(r.status, 202);
  assert.match(r.body, /HTTP\/1\.1 200 OK[\s\S]*"__count":"\d+"/);               // the read
  assert.match(r.body, /HTTP\/1\.1 400 Bad Request/);                             // the change set failed ...
  assert.equal(call('GET', `Travel/$count`).body, before);                        // ... and its create was rolled back
});

test('function imports only run on POST (a GET from a link or image must not trigger an action)', () => {
  const t = call('GET', 'Travel?$top=1').body.d.results[0];
  const before = t.OverallStatus;
  const r = call('GET', `acceptTravel?TravelUUID=guid'${t.TravelUUID}'&IsActiveEntity=true`);
  assert.equal(r.status, 405);
  assert.equal(r.headers.Allow, 'POST');
  assert.equal(call('GET', `Travel(TravelUUID=guid'${t.TravelUUID}',IsActiveEntity=true)`).body.d.OverallStatus, before);
});
