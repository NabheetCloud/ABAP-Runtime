@EndUserText.label : 'Customers (company code data)'
define table knb1 {
  key mandt : abap.clnt not null;
  key kunnr : abap.char(10) not null;
  key bukrs : abap.char(4) not null;
  akont     : abap.char(10);
  zterm     : abap.char(4);
  busab     : abap.char(2);
  loevm     : abap.char(1);
  zwels     : abap.char(20);
  fdgrv     : abap.char(20);
  zuawa     : abap.char(20);
  sperr     : abap.char(20);
  altkn     : abap.char(20);
}
