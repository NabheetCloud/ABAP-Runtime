@EndUserText.label : 'Invoice items'
define table zinv_item {
  key client     : abap.clnt not null;
  key invoice_id : abap.numc(10) not null;
  key item_no    : abap.int4 not null;
  description    : abap.char(40);
  quantity       : abap.int4;
  amount         : abap.dec(13,2);
}
