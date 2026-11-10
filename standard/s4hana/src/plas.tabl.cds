@EndUserText.label : 'Task list sequence ↔ operation'
define table plas {
  key mandt : abap.clnt not null;
  key plnty : abap.char(1) not null;
  key plnnr : abap.char(8) not null;
  key plnal : abap.char(2) not null;
  key plnfl : abap.char(6) not null;
  key plnkn : abap.numc(8) not null;
  key zaehl : abap.numc(8) not null;
  loekz     : abap.char(1);
  datuv     : abap.dats;
}
