// Late numbering + unmanaged save (Orders example): the saver assigns the keys and writes the tables itself.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Workspace } from '../src/server/server.js';

const ws = new Workspace(new URL('../examples/orders', import.meta.url).pathname, (process.env.RAP_DB ? { dbUrl: process.env.RAP_DB } : { dbFile: ':memory:' }));
const call = (m, u, b) => { try { return ws.odata.handle(m, u, b); } catch (e) { return { status: e.status || 500, body: { error: e.message, details: e.details } }; } };
const S = '/odata/zui_order';
const key = (id, active) => `${S}/SalesOrder(OrderID='${id}',IsActiveEntity=${active})`;
const sql = q => ws.app.db.prepare(q).all();

test('orders example activates without errors', () => {
  assert.deepEqual(ws.app.diagnostics.errors, []);
});

test('late numbering: drafts get preliminary keys, adjust_numbers assigns the final ones', () => {
  const c = call('POST', `${S}/SalesOrder`, { Customer: '', Currency: 'EUR' });
  assert.equal(c.status, 201);
  const tmp = c.body.OrderID;
  assert.notEqual(tmp, '0000000002');                                       // not numbered yet
  const items = [['Monitor', 2, 250], ['Keyboard', 1, 80]].map(([Product, Quantity, UnitPrice]) =>
    call('POST', `${key(tmp, false)}/_Item`, { Product, Quantity, UnitPrice }));
  assert.ok(items.every(i => i.status === 201));
  assert.equal(call('GET', key(tmp, false)).body.Total, 580);              // determination over two entities

  const bad = call('POST', `${key(tmp, false)}/Activate`, {});             // validation blocks activation
  assert.equal(bad.status, 400);
  assert.ok(bad.body.details.some(d => d.text === 'Customer is required'));

  call('PATCH', key(tmp, false), { Customer: 'Fabrikam' });
  const a = call('POST', `${key(tmp, false)}/Activate`, {});
  assert.equal(a.status, 200);
  assert.equal(a.body.OrderID, '0000000002');
  assert.deepEqual(call('GET', `${key('0000000002', true)}/_Item?$orderby=ItemNo`).body.value.map(i => i.ItemNo), ['0001', '0002']);
});

test('unmanaged save: save_modified writes inserts, updates and deletes to the tables', () => {
  assert.deepEqual(sql(`SELECT customer, total FROM zorder_h WHERE order_id = '0000000002'`).map(r => ({ ...r })), [{ customer: 'Fabrikam', total: 580 }]);

  assert.equal(call('POST', `${key('0000000001', true)}/Edit`, { PreserveChanges: true }).status, 200);
  const i = call('POST', `${key('0000000001', false)}/_Item`, { Product: 'Mouse', Quantity: 3, UnitPrice: 20 });
  assert.equal(i.status, 201);
  assert.equal(call('POST', `${key('0000000001', false)}/Activate`, {}).status, 200);
  const rows = sql(`SELECT item_no, product FROM zorder_i WHERE order_id = '0000000001' ORDER BY item_no`).map(r => ({ ...r }));
  assert.deepEqual(rows.map(r => r.item_no), ['0001', '0002', '0003']);    // per-order item counter
  assert.equal(rows[2].product, 'Mouse');
  assert.equal(sql(`SELECT total FROM zorder_h WHERE order_id = '0000000001'`)[0].total, 1560);

  assert.equal(call('DELETE', key('0000000002', true)).status, 204);
  assert.equal(sql(`SELECT COUNT(*) AS n FROM zorder_i WHERE order_id = '0000000002'`)[0].n, 0);
  assert.equal(sql(`SELECT COUNT(*) AS n FROM zorder_h WHERE order_id = '0000000002'`)[0].n, 0);
});
