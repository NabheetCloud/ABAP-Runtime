@EndUserText.label : 'Year-dependent depreciation data'
define table faat_ydda {
  key mandt : abap.clnt not null;
  key bukrs : abap.char(4) not null;
  key anln1 : abap.char(12) not null;
  key anln2 : abap.char(4) not null;
  key gjahr : abap.numc(4) not null;
  key afabe : abap.numc(2) not null;
  @Semantics.amount.currencyCode : 'faat_ydda.waers'
  kansw     : abap.curr(15,2);
  @Semantics.amount.currencyCode : 'faat_ydda.waers'
  knafa     : abap.curr(15,2);
  @Semantics.amount.currencyCode : 'faat_ydda.waers'
  nafag     : abap.curr(15,2);
  waers     : abap.cuky;
}
