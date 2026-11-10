@EndUserText.label : 'Products (valuation)'
define table mbew {
  key mandt : abap.clnt not null;
  key matnr : abap.char(40) not null;
  key bwkey : abap.char(4) not null;
  key bwtar : abap.char(10) not null;
  vprsv     : abap.char(1);
  @Semantics.amount.currencyCode : 'mbew.waers'
  verpr     : abap.curr(11,2);
  @Semantics.amount.currencyCode : 'mbew.waers'
  stprs     : abap.curr(11,2);
  peinh     : abap.dec(5,0);
  bklas     : abap.char(4);
  waers     : abap.cuky;
  lbkum     : abap.quan(13,3);
  @Semantics.amount.currencyCode : 'mbew.waers'
  salk3     : abap.curr(13,2);
}
