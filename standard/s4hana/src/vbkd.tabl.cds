@EndUserText.label : 'Business data'
define table vbkd {
  key mandt : abap.clnt not null;
  key vbeln : abap.char(10) not null;
  key posnr : abap.numc(6) not null;
  zterm     : abap.char(4);
  inco1     : abap.char(3);
  inco2     : abap.char(28);
  bstkd     : abap.char(20);
  kursk     : abap.dec(15,3);
  prsdt     : abap.dats;
  fkdat     : abap.dats;
  kdgrp     : abap.char(20);
  konda     : abap.char(20);
  pltyp     : abap.char(20);
}
