@EndUserText.label : 'Telephone numbers'
define table adr2 {
  key mandt      : abap.clnt not null;
  key addrnumber : abap.char(10) not null;
  key persnumber : abap.char(10) not null;
  key date_from  : abap.dats not null;
  key consnumber : abap.numc(3) not null;
  tel_number     : abap.char(30);
  r3_user        : abap.char(20);
  flgdefault     : abap.char(20);
}
