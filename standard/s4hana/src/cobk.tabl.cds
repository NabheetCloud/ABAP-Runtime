@EndUserText.label : 'CO document header'
define table cobk {
  key mandt : abap.clnt not null;
  key kokrs : abap.char(4) not null;
  key belnr : abap.char(10) not null;
  gjahr     : abap.numc(4);
  vrgng     : abap.char(20);
  bldat     : abap.dats;
  budat     : abap.dats;
  awtyp     : abap.char(5);
  bltxt     : abap.char(40);
  refbn     : abap.char(20);
  usnam     : abap.char(12);
}
