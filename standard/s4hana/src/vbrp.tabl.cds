@EndUserText.label : 'Billing document item'
define table vbrp {
  key mandt : abap.clnt not null;
  key vbeln : abap.char(10) not null;
  key posnr : abap.numc(6) not null;
  matnr     : abap.char(40);
  @Semantics.quantity.unitOfMeasure : 'vbrp.meins'
  fkimg     : abap.quan(13,3);
  vrkme     : abap.unit(3);
  netwr     : abap.dec(15,2);
  mwsbp     : abap.dec(15,2);
  werks     : abap.char(4);
  aubel     : abap.char(20);
  aupos     : abap.char(20);
  vgbel     : abap.char(10);
  vgpos     : abap.numc(6);
  prctr     : abap.char(10);
  kostl     : abap.char(10);
  arktx     : abap.char(40);
  vgtyp     : abap.char(20);
  charg     : abap.char(10);
  knumv     : abap.char(10);
  prodh     : abap.char(20);
  pstyv     : abap.char(4);
  @Semantics.quantity.unitOfMeasure : 'vbrp.meins'
  fklmg     : abap.quan(13,3);
  meins     : abap.unit(3);
  lgort     : abap.char(4);
  erdat     : abap.dats;
  kursk     : abap.dec(15,3);
  matkl     : abap.char(9);
  wavwr     : abap.dec(15,2);
}
