// Apps in one studio form one system: an app uses another app's master data (tables, CDS views) without copying it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Workspace } from '../src/server/server.js';
import { SYSTEM_MARKER, systemCatalog, describeCatalog } from '../src/rap/catalog.js';

const files = {
  'master/src/zproduct_a.tabl.cds': `@EndUserText.label : 'Products'
define table zproduct_a {
  key client     : abap.clnt not null;
  key product_id : abap.char(10) not null;
  name           : abap.char(40);
  price          : abap.dec(11,2);
}`,
  'master/src/zi_product.ddls.asddls': `@EndUserText.label: 'Product'
@ObjectModel.resultSet.sizeCategory: #XS
define view entity ZI_Product as select from zproduct_a
{
      @ObjectModel.text.element: ['ProductName']
  key product_id as ProductID,
      name       as ProductName,
      price      as Price
}`,
  'master/data/zproduct_a.json': `[{ "product_id": "P1", "name": "Laptop", "price": 1200 }, { "product_id": "P2", "name": "Monitor", "price": 250 }]`,
  'orders/src/zorder_a.tabl.cds': `define table zorder_a {
  key client   : abap.clnt not null;
  key order_id : abap.char(10) not null;
  product_id   : abap.char(10);
  quantity     : abap.int4;
}`,
  'orders/src/zr_order.ddls.asddls': `define root view entity ZR_Order as select from zorder_a
  association [0..1] to ZI_Product as _Product on $projection.ProductID = _Product.ProductID
{
  key order_id   as OrderID,
      @Consumption.valueHelpDefinition: [{ entity: { name: 'ZI_Product', element: 'ProductID' } }]
      product_id as ProductID,
      _Product.ProductName as ProductName,
      quantity   as Quantity,
      _Product
}`,
  'orders/src/zui_order.srvd.srvdsrv': `define service ZUI_ORDER {
  expose ZR_Order as SalesOrder;
  expose ZI_Product as Product;
}`,
  'orders/data/zorder_a.json': `[{ "order_id": "O1", "product_id": "P2", "quantity": 3 }]`,
};

function system() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rap-system-'));
  fs.writeFileSync(path.join(root, SYSTEM_MARKER), '{}');
  for (const [f, src] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(root, f)), { recursive: true }); fs.writeFileSync(path.join(root, f), src); }
  return root;
}
const pglite = /^pglite/.test(process.env.RAP_DB || '');

test('an app uses another app\'s master data: tables and views, read live, never copied', { skip: pglite && 'embedded PostgreSQL keeps apps in separate databases' }, () => {
  const root = system();
  const master = new Workspace(path.join(root, 'master'), { lint: false, systemDir: root });       // owns zproduct_a, creates its database
  const orders = new Workspace(path.join(root, 'orders'), { lint: false, systemDir: root });
  assert.deepEqual(orders.app.diagnostics.errors, []);
  assert.deepEqual([...orders.app.model.externals.keys()].sort(), ['zi_product', 'zproduct_a']);
  assert.equal(orders.app.db.tableExists('zproduct_a'), false);                                  // no copy in the orders database

  const call = u => orders.odata.handle('GET', u);
  assert.deepEqual(call('/odata/zui_order/Product?$orderby=ProductID').body.value.map(p => p.ProductName), ['Laptop', 'Monitor']);
  assert.equal(call('/odata/zui_order/SalesOrder').body.value[0].ProductName, 'Monitor');         // association into the other app
  assert.match(orders.odata.handle('GET', '/odata/zui_order/$metadata').body, /Common.ValueListWithFixedValues/);   // drop-down

  master.app.db.prepare(`INSERT INTO zproduct_a (product_id, name, price) VALUES ('P3', 'Docking station', 150)`).run();
  assert.equal(call('/odata/zui_order/Product').body.value.length, 3);                           // live, not a snapshot

  const cat = systemCatalog(root, path.join(root, 'orders'));
  assert.ok(describeCatalog(cat, 'product').some(r => r.startsWith('ZI_Product') && r.includes('drop-down')));
  orders.close?.(); master.close?.();
});

test('without the owner app the reference stays unresolved; embedded PostgreSQL explains why it cannot share', () => {
  const root = system();
  if (pglite) {
    const orders = new Workspace(path.join(root, 'orders'), { lint: false, systemDir: root, dbUrl: 'pglite:memory' });
    assert.ok(orders.app.diagnostics.errors.some(e => /pglite/.test(e.message)));
    return;
  }
  fs.rmSync(path.join(root, SYSTEM_MARKER));
  const alone = new Workspace(path.join(root, 'orders'), { lint: false, dbFile: ':memory:' });   // standalone: no system
  assert.ok(alone.app.diagnostics.errors.length + alone.app.diagnostics.warnings.length > 0);
  assert.equal(alone.app.model.externals?.size || 0, 0);
});
