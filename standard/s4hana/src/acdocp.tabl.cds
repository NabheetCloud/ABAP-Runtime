@EndUserText.label : 'Plan data line items'
define table acdocp {
  key mandt    : abap.clnt not null;
  key rldnr    : abap.char(2) not null;
  key rbukrs   : abap.char(4) not null;
  key gjahr    : abap.numc(4) not null;
  key belnr    : abap.char(10) not null;
  key docln    : abap.numc(6) not null;
  category     : abap.char(4);
  budat        : abap.dats;
  @Semantics.amount.currencyCode : 'acdocp.rhcur'
  hsl          : abap.curr(15,2);
  plevl        : abap.char(20);
  poper        : abap.numc(3);
  prctr        : abap.char(10);
  racct        : abap.char(10);
  rcntr        : abap.char(10);
  rhcur        : abap.cuky;
}
