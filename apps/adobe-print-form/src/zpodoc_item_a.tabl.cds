@EndUserText.label : 'Purchase order document item (print)'
define table zpodoc_item_a {
  key client    : abap.clnt not null;
  key po_number : abap.numc(10) not null;
  key item_no   : abap.numc(5) not null;
  product       : abap.char(40);
  quantity      : abap.dec(13,3);
  unit          : abap.unit(3);
  unit_price    : abap.dec(13,2);
}
