@EndUserText.label : 'Valuation history'
define table mbewh {
  key mandt : abap.clnt not null;
  key matnr : abap.char(40) not null;
  key bwkey : abap.char(4) not null;
  key bwtar : abap.char(10) not null;
  key lfgja : abap.numc(4) not null;
  key lfmon : abap.numc(2) not null;
  lbkum     : abap.dec(13,3);
  peinh     : abap.dec(15,3);
  salk3     : abap.dec(15,2);
  stprs     : abap.dec(15,2);
  verpr     : abap.dec(15,2);
  vprsv     : abap.char(1);
}
