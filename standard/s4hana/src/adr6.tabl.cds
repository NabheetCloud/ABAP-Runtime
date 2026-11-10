@EndUserText.label : 'E-mail addresses'
define table adr6 {
  key mandt      : abap.clnt not null;
  key addrnumber : abap.char(10) not null;
  key persnumber : abap.char(10) not null;
  key date_from  : abap.dats not null;
  key consnumber : abap.numc(3) not null;
  smtp_addr      : abap.char(241);
  flgdefault     : abap.char(20);
}
