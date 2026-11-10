@EndUserText.label : 'Material ↔ task list'
define table mapl {
  key mandt : abap.clnt not null;
  key matnr : abap.char(40) not null;
  key werks : abap.char(4) not null;
  key plnty : abap.char(1) not null;
  key plnnr : abap.char(8) not null;
  key plnal : abap.char(2) not null;
  key zkriz : abap.numc(10) not null;
  key zaehl : abap.numc(8) not null;
  datuv     : abap.dats;
  loekz     : abap.char(1);
}
