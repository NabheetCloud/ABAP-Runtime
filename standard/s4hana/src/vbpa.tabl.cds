@EndUserText.label : 'Partners'
define table vbpa {
  key mandt : abap.clnt not null;
  key vbeln : abap.char(10) not null;
  key posnr : abap.numc(6) not null;
  key parvw : abap.char(2) not null;
  key parza : abap.numc(3) not null;
  kunnr     : abap.char(10);
  lifnr     : abap.char(10);
  pernr     : abap.char(8);
  parnr     : abap.numc(10);
  adrnr     : abap.char(10);
  land1     : abap.char(3);
  ablad     : abap.char(20);
  knref     : abap.char(20);
}
