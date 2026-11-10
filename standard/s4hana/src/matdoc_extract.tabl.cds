@EndUserText.label : 'Aggregated stock extract (performance)'
define table matdoc_extract {
  key mandt     : abap.clnt not null;
  key matnr     : abap.char(40) not null;
  key werks     : abap.char(4) not null;
  key lgort     : abap.char(4) not null;
  key charg     : abap.char(10) not null;
  key sobkz     : abap.char(1) not null;
  key lbbsa     : abap.char(2) not null;
  @Semantics.quantity.unitOfMeasure : 'matdoc_extract.meins'
  stock_qty     : abap.quan(13,3);
  meins         : abap.unit(3);
  @Semantics.amount.currencyCode : 'matdoc_extract.waers'
  value_lc      : abap.curr(15,2);
  waers         : abap.cuky;
}
