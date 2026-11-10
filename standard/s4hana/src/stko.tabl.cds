@EndUserText.label : 'BOM header'
define table stko {
  key mandt : abap.clnt not null;
  key stlty : abap.char(1) not null;
  key stlnr : abap.char(8) not null;
  key stlal : abap.char(2) not null;
  key stkoz : abap.numc(8) not null;
  datuv     : abap.dats;
  bmeng     : abap.dec(13,3);
  bmein     : abap.char(20);
  stlst     : abap.char(20);
  loekz     : abap.char(1);
  andat     : abap.dats;
  annam     : abap.char(20);
  stktx     : abap.char(20);
}
