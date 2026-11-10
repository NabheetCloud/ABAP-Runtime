@EndUserText.label : 'Goods receipt confirmation of a purchase order'
define table zpodoc_gr_a {
  key client    : abap.clnt not null;
  key po_number : abap.numc(10) not null;
  received_by   : abap.char(40);
  received_on   : abap.dats;
  complete      : abap_boolean;
  remark        : abap.char(255);
  is_signed     : abap_boolean;
  signer        : abap.char(80);
  confirmed_at  : timestampl;
}
