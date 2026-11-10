@EndUserText.label : 'BOM item selection'
define table stas {
  key mandt : abap.clnt not null;
  key stlty : abap.char(1) not null;
  key stlnr : abap.char(8) not null;
  key stlal : abap.char(2) not null;
  key stlkn : abap.numc(8) not null;
  key stasz : abap.numc(8) not null;
  datuv     : abap.dats;
  lkenz     : abap.char(20);
  andat     : abap.dats;
}
