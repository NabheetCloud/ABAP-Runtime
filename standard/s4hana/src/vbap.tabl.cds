@EndUserText.label : 'Sales document item'
define table vbap {
  key mandt  : abap.clnt not null;
  key vbeln  : abap.char(10) not null;
  key posnr  : abap.numc(6) not null;
  matnr      : abap.char(40);
  arktx      : abap.char(40);
  pstyv      : abap.char(4);
  uepos      : abap.numc(6);
  abgru      : abap.char(2);
  @Semantics.quantity.unitOfMeasure : 'vbap.meins'
  kwmeng     : abap.quan(13,3);
  vrkme      : abap.unit(3);
  @Semantics.quantity.unitOfMeasure : 'vbap.meins'
  klmeng     : abap.quan(13,3);
  meins      : abap.unit(3);
  @Semantics.amount.currencyCode : 'vbap.waerk'
  netwr      : abap.curr(15,2);
  @Semantics.amount.currencyCode : 'vbap.waerk'
  netpr      : abap.curr(15,2);
  waerk      : abap.cuky;
  werks      : abap.char(4);
  lgort      : abap.char(4);
  vstel      : abap.char(4);
  route      : abap.char(6);
  charg      : abap.char(10);
  prctr      : abap.char(10);
  vgbel      : abap.char(10);
  vgpos      : abap.numc(6);
  gbsta      : abap.char(1);
  lfsta      : abap.char(1);
  fksaa      : abap.char(1);
  absta      : abap.char(1);
  matkl      : abap.char(9);
  kpein      : abap.dec(15,3);
  kmein      : abap.unit(3);
  faksp      : abap.char(20);
  lifsp      : abap.char(20);
  fkrel      : abap.char(1);
  fksta      : abap.char(20);
  posex      : abap.char(20);
  knumv      : abap.char(10);
  erdat      : abap.dats;
  ernam      : abap.char(12);
  @Semantics.amount.currencyCode : 'vbap.waerk'
  mwsbp      : abap.curr(15,2);
  umvkn      : abap.char(20);
  umvkz      : abap.char(20);
}
