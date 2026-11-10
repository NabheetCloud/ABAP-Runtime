@EndUserText.label : 'Document flow'
define table vbfa {
  key mandt   : abap.clnt not null;
  key ruuid   : abap.char(32) not null;
  posnv       : abap.numc(6);
  vbeln       : abap.char(10);
  posnn       : abap.numc(6);
  vbtyp_n     : abap.char(4);
  vbtyp_v     : abap.char(4);
  @Semantics.quantity.unitOfMeasure : 'vbfa.meins'
  rfmng       : abap.quan(13,3);
  meins       : abap.unit(3);
  @Semantics.amount.currencyCode : 'vbfa.waers'
  rfwrt       : abap.curr(15,2);
  erdat       : abap.dats;
  bwart       : abap.char(3);
  vbelv       : abap.char(10);
  plmin       : abap.char(1);
  erzet       : abap.tims;
  waers       : abap.cuky;
}
