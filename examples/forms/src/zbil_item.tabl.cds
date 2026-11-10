@EndUserText.label : 'Billing document items'
define table zbil_item {
  key client      : abap.clnt not null;
  key billing_doc : abap.numc(10) not null;
  key item_no     : abap.numc(6) not null;
  category        : abap.char(20);
  material        : abap.char(18);
  description     : abap.char(120);
  quantity        : abap.dec(13,3);
  unit            : abap.unit(3);
  unit_price      : abap.dec(13,2);
}
