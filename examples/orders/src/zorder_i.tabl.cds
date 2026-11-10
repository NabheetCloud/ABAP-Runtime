@EndUserText.label : 'Sales order item'
define table zorder_i {
  key client   : abap.clnt not null;
  key order_id : abap.numc(10) not null;
  key item_no  : abap.numc(4) not null;
  product      : abap.char(60);
  quantity     : abap.int4;
  unit_price   : abap.curr(16,2);
  currency     : abap.cuky;
  amount       : abap.curr(16,2);
}
