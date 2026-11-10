@EndUserText.label : 'CO actual line items (classic)'
define table coep {
  key mandt  : abap.clnt not null;
  key kokrs  : abap.char(4) not null;
  key belnr  : abap.char(10) not null;
  key buzei  : abap.numc(3) not null;
  gjahr      : abap.numc(4);
  perio      : abap.char(6);
  objnr      : abap.char(22);
  kstar      : abap.char(20);
  wrttp      : abap.char(20);
  versn      : abap.char(4);
  vrgng      : abap.char(20);
  wkgbtr     : abap.dec(15,2);
  wtgbtr     : abap.dec(15,2);
  twaer      : abap.char(20);
  owaer      : abap.char(20);
  bukrs      : abap.char(4);
  beltp      : abap.char(20);
  meinh      : abap.unit(3);
  mbgbtr     : abap.char(20);
  sgtxt      : abap.char(50);
  budat      : abap.dats;
  refbn      : abap.char(20);
  awtyp      : abap.char(5);
}
