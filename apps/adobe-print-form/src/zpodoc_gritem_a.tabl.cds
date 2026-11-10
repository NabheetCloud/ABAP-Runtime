@EndUserText.label : 'Goods receipt confirmation: received quantity per item'
define table zpodoc_gritem_a {
  key client    : abap.clnt not null;
  key po_number : abap.numc(10) not null;
  key item_no   : abap.numc(5) not null;
  received_qty  : abap.dec(13,3);
}
