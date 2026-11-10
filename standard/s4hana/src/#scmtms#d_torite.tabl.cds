@EndUserText.label : 'Freight order items'
define table /scmtms/d_torite {
  key mandt           : abap.clnt not null;
  key db_key          : abap.char(32) not null;
  parent_key          : abap.char(32);
  item_id             : abap.char(10);
  item_cat            : abap.char(3);
  product_id          : abap.char(40);
  qua_pcs_val         : abap.dec(13,3);
  qua_pcs_uni         : abap.unit(3);
  gro_wei_val         : abap.dec(15,3);
  gro_wei_uni         : abap.unit(3);
  base_btd_id         : abap.char(35);
  base_btditem_id     : abap.char(10);
}
