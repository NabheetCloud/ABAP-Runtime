@EndUserText.label : 'Purchase order document (print)'
define table zpodoc_a {
  key client       : abap.clnt not null;
  key po_number    : abap.numc(10) not null;
  company_code     : abap.char(4);
  plant            : abap.char(4);
  supplier         : abap.char(10);
  purchasing_group : abap.char(3);
  buyer_name       : abap.char(40);
  order_date       : abap.dats;
  delivery_date    : abap.dats;
  currency         : abap.cuky;
  status           : abap.char(1);
}
