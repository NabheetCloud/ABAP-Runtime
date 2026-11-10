@EndUserText.label : 'Goods movement document'
define table matdoc {
  key mandt       : abap.clnt not null;
  key mblnr       : abap.char(10) not null;
  key mjahr       : abap.numc(4) not null;
  key zeile       : abap.numc(4) not null;
  bwart           : abap.char(3);
  matnr           : abap.char(40);
  werks           : abap.char(4);
  lgort           : abap.char(4);
  charg           : abap.char(10);
  @Semantics.quantity.unitOfMeasure : 'matdoc.meins'
  menge           : abap.quan(13,3);
  meins           : abap.unit(3);
  shkzg           : abap.char(1);
  sobkz           : abap.char(1);
  aufnr           : abap.char(12);
  budat           : abap.dats;
  xblnr           : abap.char(16);
  key1            : abap.char(10);
  key2            : abap.char(4);
  key3            : abap.char(4);
  key4            : abap.char(10);
  key5            : abap.char(4);
  key6            : abap.char(4);
  lifnr           : abap.char(10);
  kunnr           : abap.char(10);
  kdauf           : abap.char(10);
  kdpos           : abap.numc(6);
  @Semantics.quantity.unitOfMeasure : 'matdoc.meins'
  erfmg           : abap.quan(13,3);
  erfme           : abap.unit(3);
  @Semantics.amount.currencyCode : 'matdoc.waers'
  dmbtr           : abap.curr(15,2);
  waers           : abap.cuky;
  bldat           : abap.dats;
  cpudt           : abap.dats;
  usnam           : abap.char(12);
  ebeln           : abap.char(10);
  ebelp           : abap.numc(5);
  kostl           : abap.char(10);
  rsnum           : abap.char(10);
  rspos           : abap.numc(4);
  vbeln_im        : abap.char(20);
  vbelp_im        : abap.numc(6);
  sjahr           : abap.numc(4);
  smbln           : abap.char(10);
  smblp           : abap.numc(4);
  record_type     : abap.char(4);
  @Semantics.quantity.unitOfMeasure : 'matdoc.meins'
  stock_qty       : abap.quan(13,3);
  insmk           : abap.char(20);
  cputm           : abap.tims;
  bktxt           : abap.char(25);
  vgart           : abap.char(20);
  kzbew           : abap.char(1);
  kzvbr           : abap.char(1);
  lbbsa           : abap.char(2);
  sgtxt           : abap.char(50);
  umlgo           : abap.char(20);
}
