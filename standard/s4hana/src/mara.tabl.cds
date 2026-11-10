@EndUserText.label : 'Products (general data)'
define table mara {
  key mandt : abap.clnt not null;
  key matnr : abap.char(40) not null;
  mtart     : abap.char(4);
  matkl     : abap.char(9);
  meins     : abap.unit(3);
  @Semantics.quantity.unitOfMeasure : 'mara.gewei'
  brgew     : abap.quan(13,3);
  @Semantics.quantity.unitOfMeasure : 'mara.gewei'
  ntgew     : abap.quan(13,3);
  gewei     : abap.unit(3);
  @Semantics.quantity.unitOfMeasure : 'mara.voleh'
  volum     : abap.quan(13,3);
  voleh     : abap.unit(3);
  spart     : abap.char(2);
  bismt     : abap.char(40);
  ean11     : abap.char(18);
  mstae     : abap.char(2);
  lvorm     : abap.char(1);
  ersda     : abap.dats;
  ernam     : abap.char(12);
  laeda     : abap.dats;
  xchpf     : abap.char(1);
  prdha     : abap.char(20);
  aenam     : abap.char(12);
  vpsta     : abap.char(20);
  pstat     : abap.char(20);
  mbrsh     : abap.char(20);
  mhdhb     : abap.char(20);
}
