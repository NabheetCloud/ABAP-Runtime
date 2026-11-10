// Packed numbers typed from the dictionary on the RAP runtime: a data element with a CURR / QUAN / DEC domain, a
// table field and a CDS view field keep their decimals in string templates, WRITE, CONV and moves into text.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Workspace } from '../src/server/server.js';

const PO = new URL('./fixtures/po-classic/src', import.meta.url).pathname;
const doma = (name, type, leng, dec) => fs.readFileSync(path.join(PO, 'zpo_amount.doma.xml'), 'utf8').replace(/ZPO_AMOUNT/g, name.toUpperCase())
  .replace(/<DATATYPE>[^<]*</, `<DATATYPE>${type}<`).replace(/<LENG>[^<]*</, `<LENG>${leng}<`).replace(/<DECIMALS>[^<]*</, `<DECIMALS>${dec}<`);
const dtel = (name, dom) => fs.readFileSync(path.join(PO, 'zpo_netwr.dtel.xml'), 'utf8').replace(/ZPO_NETWR/g, name.toUpperCase()).replace(/ZPO_AMOUNT/g, dom.toUpperCase());

test('decimals of dictionary types: CURR with currency, QUAN, DEC in templates, WRITE, CONV and moves', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rap-dec-'));
  const src = path.join(dir, 'src');
  fs.mkdirSync(src);
  for (const f of ['zpo_amount.doma.xml', 'zpo_qty.doma.xml', 'zpo_netwr.dtel.xml', 'zpo_menge.dtel.xml', 'zpo_ebeln.dtel.xml', 'zpo_stat.dtel.xml', 'zpo_status.doma.xml',
    'zpo_head.tabl.cds', 'zpo_item.tabl.cds', 'zi_po_head.ddls.asddls']) fs.copyFileSync(path.join(PO, f), path.join(src, f));
  fs.writeFileSync(path.join(src, 'zdec_rate.doma.xml'), doma('zdec_rate', 'DEC', '000007', '000004'));
  fs.writeFileSync(path.join(src, 'zdec_rate.dtel.xml'), dtel('zdec_rate', 'zdec_rate'));
  fs.writeFileSync(path.join(src, 'zcl_dec.clas.abap'), `CLASS zcl_dec DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES if_oo_adt_classrun.
ENDCLASS.
CLASS zcl_dec IMPLEMENTATION.
  METHOD if_oo_adt_classrun~main.
    DATA lv_amount TYPE zpo_netwr.
    DATA lv_qty TYPE zpo_menge.
    DATA lv_rate TYPE zdec_rate.
    DATA ls_head TYPE zpo_head.
    DATA lv_text TYPE string.
    DATA lv_char TYPE c LENGTH 12.
    lv_amount = 600.
    lv_qty = 2.
    lv_rate = '1.5'.
    ls_head-netwr = '1234.5'.
    ls_head-waers = 'EUR'.
    out->write( |amount { lv_amount } qty { lv_qty } rate { lv_rate }| ).
    out->write( |head { ls_head-netwr } { ls_head-waers }| ).
    out->write( |neg { 0 - lv_amount }/{ CONV zpo_netwr( 0 - lv_amount ) }| ).
    lv_text = lv_amount.
    lv_char = lv_qty.
    out->write( |move { lv_text }/{ lv_char }/{ CONV string( lv_rate ) }| ).
    INSERT zpo_head FROM @( VALUE #( ebeln = '4500000099' netwr = '99.9' waers = 'USD' ) ).
    SELECT SINGLE Netwr, Waers FROM zi_po_head WHERE Ebeln = '4500000099' INTO @DATA(ls_view).
    out->write( |view { ls_view-netwr } { ls_view-waers }| ).
    SELECT SINGLE * FROM zpo_head WHERE ebeln = '4500000099' INTO @DATA(ls_row).
    out->write( |table { ls_row-netwr }| ).
    WRITE lv_amount.
  ENDMETHOD.
ENDCLASS.
`);
  const ws = new Workspace(dir, { systemDir: false, lint: false });
  try {
    assert.deepEqual(ws.app.diagnostics.errors, []);
    const r = ws.runClass('zcl_dec');
    assert.equal(r.ok, true, r.error);
    assert.match(r.output, /^amount 600\.00 qty 2\.000 rate 1\.5000$/m);
    assert.match(r.output, /^head 1234\.50 EUR$/m);
    assert.match(r.output, /^neg -600\/-600\.00$/m);                    // an expression has no dictionary type
    assert.match(r.output, /^move 600\.00\/2\.000\/1\.5000$/m);
    assert.match(r.output, /^view 99\.90 USD$/m);
    assert.match(r.output, /^table 99\.90$/m);
    assert.deepEqual(ws.app.rt.output, ['600.00']);                      // WRITE (the list of the run; on the classic
    // engine WRITE lists are checked in po-classic.test.mjs: 2100.00 / 2.000 / 900.00)
  } finally { ws.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});
