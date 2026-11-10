@EndUserText.label : 'Order confirmations'
define table afru {
  key mandt : abap.clnt not null;
  key rueck : abap.numc(10) not null;
  key rmzhl : abap.numc(8) not null;
  aufnr     : abap.char(12);
  vornr     : abap.char(4);
  arbid     : abap.char(20);
  budat     : abap.dats;
  lmnga     : abap.dec(13,3);
  xmnga     : abap.dec(13,3);
  aueru     : abap.char(20);
  stokz     : abap.char(20);
  stzhl     : abap.char(20);
  ernam     : abap.char(12);
  ersda     : abap.dats;
  gmein     : abap.unit(3);
  ile01     : abap.char(20);
  @Semantics.quantity.unitOfMeasure : 'afru.gmein'
  ism01     : abap.quan(13,3);
  ltxa1     : abap.char(20);
  werks     : abap.char(4);
}
