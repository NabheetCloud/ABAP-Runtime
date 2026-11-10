@EndUserText.label : 'Legacy orders'
define table zlegacy_ord {
  key client   : abap.clnt not null;
  key order_no : abap.numc(8) not null;
  customer     : abap.char(40);
  amount       : abap.dec(11,2);
  status       : abap.char(1);
  changed_at   : abap.dec(21,7);
}
