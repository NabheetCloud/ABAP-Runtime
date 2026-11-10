@EndUserText.label : 'Supplier invoice header (MIRO)'
define table rbkp {
  key mandt  : abap.clnt not null;
  key belnr  : abap.char(10) not null;
  key gjahr  : abap.numc(4) not null;
  bukrs      : abap.char(4);
  lifnr      : abap.char(10);
  bldat      : abap.dats;
  budat      : abap.dats;
  xblnr      : abap.char(16);
  @Semantics.amount.currencyCode : 'rbkp.waers'
  rmwwr      : abap.curr(15,2);
  @Semantics.amount.currencyCode : 'rbkp.waers'
  wmwst1     : abap.curr(15,2);
  waers      : abap.cuky;
  rbstat     : abap.char(1);
  zterm      : abap.char(4);
  stblg      : abap.char(20);
  rbkp       : abap.char(20);
  rseg       : abap.char(20);
  buzei      : abap.numc(3);
  blart      : abap.char(2);
  cpudt      : abap.dats;
  ivtyp      : abap.char(20);
  kursf      : abap.dec(15,3);
  usnam      : abap.char(12);
}
