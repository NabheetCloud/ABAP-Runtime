@EndUserText.label : 'Task list (routing) header'
define table plko {
  key mandt : abap.clnt not null;
  key plnty : abap.char(1) not null;
  key plnnr : abap.char(8) not null;
  key plnal : abap.char(2) not null;
  key zaehl : abap.numc(8) not null;
  datuv     : abap.dats;
  werks     : abap.char(4);
  verwe     : abap.char(20);
  statu     : abap.char(1);
  losvn     : abap.char(20);
  losbs     : abap.char(20);
  ktext     : abap.char(40);
  plnme     : abap.char(20);
}
