@EndUserText.label : 'Delivery item'
define table lips {
  key mandt  : abap.clnt not null;
  key vbeln  : abap.char(10) not null;
  key posnr  : abap.numc(6) not null;
  matnr      : abap.char(40);
  werks      : abap.char(4);
  lgort      : abap.char(4);
  charg      : abap.char(10);
  @Semantics.quantity.unitOfMeasure : 'lips.meins'
  lfimg      : abap.quan(13,3);
  vrkme      : abap.unit(3);
  @Semantics.quantity.unitOfMeasure : 'lips.meins'
  lgmng      : abap.quan(13,3);
  meins      : abap.unit(3);
  vgbel      : abap.char(10);
  vgpos      : abap.numc(6);
  pstyv      : abap.char(4);
  kosta      : abap.char(20);
  wbsta      : abap.char(20);
  uecha      : abap.char(20);
  arktx      : abap.char(40);
  vgtyp      : abap.char(20);
  @Semantics.quantity.unitOfMeasure : 'lips.meins'
  kcmeng     : abap.quan(13,3);
  vkbur      : abap.char(4);
  erdat      : abap.dats;
  matkl      : abap.char(9);
  prctr      : abap.char(10);
  umvkn      : abap.char(20);
  umvkz      : abap.char(20);
}
