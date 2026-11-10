@EndUserText.label : 'Suppliers (company code data)'
define table lfb1 {
  key mandt : abap.clnt not null;
  key lifnr : abap.char(10) not null;
  key bukrs : abap.char(4) not null;
  akont     : abap.char(10);
  zterm     : abap.char(4);
  loevm     : abap.char(1);
  zwels     : abap.char(20);
  qsskz     : abap.char(20);
  reprf     : abap.char(20);
  zuawa     : abap.char(20);
  sperr     : abap.char(20);
  busab     : abap.char(20);
  altkn     : abap.char(20);
}
