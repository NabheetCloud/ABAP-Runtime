@EndUserText.label : 'Bank statement items'
define table febep {
  key mandt : abap.clnt not null;
  key kukey : abap.char(8) not null;
  key esnum : abap.char(5) not null;
  valut     : abap.dats;
  budat     : abap.dats;
  kwbtr     : abap.dec(15,2);
  vgint     : abap.char(20);
  belnr     : abap.char(10);
  nbbln     : abap.char(20);
  sgtxt     : abap.char(50);
  gjahr     : abap.numc(4);
  partn     : abap.char(20);
  vgext     : abap.char(20);
}
