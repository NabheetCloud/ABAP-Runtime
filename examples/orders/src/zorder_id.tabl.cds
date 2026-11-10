@EndUserText.label : 'Sales order item - draft'
define table zorder_id {
  key mandt   : abap.clnt not null;
  key orderid : abap.numc(10) not null;
  key itemno  : abap.numc(4) not null;
  product     : abap.char(60);
  quantity    : abap.int4;
  unitprice   : abap.curr(16,2);
  currency    : abap.cuky;
  amount      : abap.curr(16,2);
  "%admin"    : include sych_bdl_draft_admin_inc;
}
