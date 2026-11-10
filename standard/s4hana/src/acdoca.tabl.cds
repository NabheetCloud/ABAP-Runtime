@EndUserText.label : 'Universal Journal'
define table acdoca {
  key mandt       : abap.clnt not null;
  key rldnr       : abap.char(2) not null;
  key rbukrs      : abap.char(4) not null;
  key gjahr       : abap.numc(4) not null;
  key belnr       : abap.char(10) not null;
  key docln       : abap.numc(6) not null;
  racct           : abap.char(10);
  kunnr           : abap.char(10);
  lifnr           : abap.char(10);
  matnr           : abap.char(40);
  werks           : abap.char(4);
  prctr           : abap.char(10);
  kostl           : abap.char(10);
  segment         : abap.char(10);
  aufnr           : abap.char(12);
  ps_psp_pnr      : abap.char(8);
  budat           : abap.dats;
  bldat           : abap.dats;
  @Semantics.amount.currencyCode : 'acdoca.rhcur'
  hsl             : abap.curr(15,2);
  @Semantics.amount.currencyCode : 'acdoca.rkcur'
  ksl             : abap.curr(15,2);
  @Semantics.amount.currencyCode : 'acdoca.rwcur'
  tsl             : abap.curr(15,2);
  rwcur           : abap.cuky;
  rhcur           : abap.cuky;
  rkcur           : abap.cuky;
  drcrk           : abap.char(1);
  bschl           : abap.char(2);
  koart           : abap.char(1);
  anln1           : abap.char(12);
  anln2           : abap.char(4);
  anbwa           : abap.char(3);
  afabe           : abap.numc(2);
  acdoca          : abap.char(20);
  vbeln           : abap.char(10);
  posnr           : abap.numc(6);
  rcntr           : abap.char(10);
  blart           : abap.char(2);
  poper           : abap.numc(3);
  rtcur           : abap.cuky;
  mwskz           : abap.char(2);
  zuonr           : abap.char(18);
  sgtxt           : abap.char(50);
  augbl           : abap.char(10);
  augdt           : abap.dats;
  kokrs           : abap.char(4);
  gsber           : abap.char(4);
  ebeln           : abap.char(10);
  ebelp           : abap.numc(5);
  aworg           : abap.char(10);
  awref           : abap.char(10);
  awtyp           : abap.char(5);
  buzei           : abap.numc(3);
  fiscyearper     : abap.char(20);
  ktopl           : abap.char(4);
  ktosl           : abap.char(3);
  @Semantics.quantity.unitOfMeasure : 'acdoca.runit'
  msl             : abap.quan(13,3);
  runit           : abap.unit(3);
  usnam           : abap.char(12);
  zterm           : abap.char(4);
}
