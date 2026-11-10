@EndUserText.label : 'Sales'
define table zsale_a {
  key client  : abap.clnt not null;
  key sale_id : abap.char(10) not null;
  region      : abap.char(4);
  amount      : abap.dec(11,2);
  owner       : abap.char(12);
}
