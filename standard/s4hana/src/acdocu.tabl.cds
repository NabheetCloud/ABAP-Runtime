@EndUserText.label : 'Group reporting (consolidation) journal'
define table acdocu {
  key mandt  : abap.clnt not null;
  key rldnr  : abap.char(2) not null;
  key rvers  : abap.char(3) not null;
  key ryear  : abap.char(4) not null;
  key docnr  : abap.char(10) not null;
  key docln  : abap.numc(6) not null;
  poper      : abap.numc(3);
  rbunit     : abap.char(20);
  ritem      : abap.char(20);
  @Semantics.amount.currencyCode : 'acdocu.rhcur'
  hsl        : abap.curr(15,2);
  @Semantics.amount.currencyCode : 'acdocu.rtcur'
  kslu       : abap.curr(15,2);
  racct      : abap.char(10);
  rhcur      : abap.cuky;
  rtcur      : abap.cuky;
}
