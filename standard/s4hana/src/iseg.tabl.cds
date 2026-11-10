@EndUserText.label : 'Physical inventory item'
define table iseg {
  key mandt     : abap.clnt not null;
  key iblnr     : abap.char(10) not null;
  key gjahr     : abap.numc(4) not null;
  key zeili     : abap.numc(3) not null;
  matnr         : abap.char(40);
  charg         : abap.char(10);
  buchm         : abap.dec(13,3);
  menge         : abap.dec(13,3);
  differenz     : abap.char(20);
  xzael         : abap.char(1);
  xdiff         : abap.char(1);
  @Semantics.amount.currencyCode : 'iseg.waers'
  dmbtr         : abap.curr(15,2);
  lgort         : abap.char(4);
  meins         : abap.unit(3);
  waers         : abap.cuky;
  werks         : abap.char(4);
  xnull         : abap.char(1);
}
