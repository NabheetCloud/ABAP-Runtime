@EndUserText.label : 'Schedule lines'
define table vbep {
  key mandt : abap.clnt not null;
  key vbeln : abap.char(10) not null;
  key posnr : abap.numc(6) not null;
  key etenr : abap.numc(4) not null;
  edatu     : abap.dats;
  wmeng     : abap.dec(13,3);
  bmeng     : abap.dec(13,3);
  lmeng     : abap.dec(13,3);
  ettyp     : abap.char(20);
  mbdat     : abap.dats;
  lddat     : abap.dats;
  wadat     : abap.dats;
  tddat     : abap.dats;
  bdart     : abap.char(20);
  plart     : abap.char(20);
  etart     : abap.char(20);
  meins     : abap.unit(3);
  vrkme     : abap.unit(3);
}
