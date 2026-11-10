@EndUserText.label : 'Basic pay'
define table pa0008 {
  key mandt : abap.clnt not null;
  key pernr : abap.char(8) not null;
  key subty : abap.char(4) not null;
  key objps : abap.char(2) not null;
  key sprps : abap.char(1) not null;
  key endda : abap.dats not null;
  key begda : abap.dats not null;
  key seqnr : abap.numc(3) not null;
  trfar     : abap.char(2);
  trfgb     : abap.char(2);
  betrg     : abap.dec(15,2);
  trfgr     : abap.char(8);
  trfst     : abap.char(2);
  aedtm     : abap.dats;
  @Semantics.amount.currencyCode : 'pa0008.waers'
  bet01     : abap.curr(15,2);
  lga01     : abap.char(20);
  uname     : abap.char(12);
  waers     : abap.cuky;
}
