@EndUserText.label : 'Maintenance plan call history'
define table mhis {
  key mandt : abap.clnt not null;
  key warpl : abap.char(12) not null;
  key abnum : abap.numc(4) not null;
  nplda     : abap.dats;
  horda     : abap.dats;
  lrmdt     : abap.dats;
  tstat     : abap.char(20);
}
