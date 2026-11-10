@EndUserText.label : 'Production order header'
define table afko {
  key mandt  : abap.clnt not null;
  key aufnr  : abap.char(12) not null;
  plnbez     : abap.char(40);
  @Semantics.quantity.unitOfMeasure : 'afko.gmein'
  gamng      : abap.quan(13,3);
  gmein      : abap.unit(3);
  gstrp      : abap.dats;
  gltrp      : abap.dats;
  gstrs      : abap.dats;
  gltrs      : abap.dats;
  ftrmi      : abap.dats;
  aufpl      : abap.numc(10);
  rsnum      : abap.char(10);
  stlnr      : abap.char(8);
  plnnr      : abap.char(8);
  dispo      : abap.char(20);
  fevor      : abap.char(20);
  getri      : abap.dats;
  @Semantics.quantity.unitOfMeasure : 'afko.gmein'
  igmng      : abap.quan(13,3);
  plnal      : abap.char(2);
  plnty      : abap.char(1);
  stlal      : abap.char(2);
}
