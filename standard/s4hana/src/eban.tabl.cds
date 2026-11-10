@EndUserText.label : 'Purchase requisition (item level table)'
define table eban {
  key mandt : abap.clnt not null;
  key banfn : abap.char(10) not null;
  key bnfpo : abap.numc(5) not null;
  bsart     : abap.char(4);
  matnr     : abap.char(40);
  werks     : abap.char(4);
  lgort     : abap.char(4);
  @Semantics.quantity.unitOfMeasure : 'eban.meins'
  menge     : abap.quan(13,3);
  meins     : abap.unit(3);
  badat     : abap.dats;
  lfdat     : abap.dats;
  ekgrp     : abap.char(3);
  ekorg     : abap.char(4);
  flief     : abap.char(10);
  knttp     : abap.char(1);
  ebeln     : abap.char(10);
  ebelp     : abap.numc(5);
  frgkz     : abap.char(1);
  loekz     : abap.char(1);
  txz01     : abap.char(40);
  matkl     : abap.char(9);
  afnam     : abap.char(20);
  bstyp     : abap.char(1);
  erdat     : abap.dats;
  ernam     : abap.char(12);
  @Semantics.amount.currencyCode : 'eban.waers'
  preis     : abap.curr(15,2);
  statu     : abap.char(1);
  waers     : abap.cuky;
}
