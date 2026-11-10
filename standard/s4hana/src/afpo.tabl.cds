@EndUserText.label : 'Production order item'
define table afpo {
  key mandt : abap.clnt not null;
  key aufnr : abap.char(12) not null;
  key posnr : abap.numc(6) not null;
  matnr     : abap.char(40);
  psmng     : abap.dec(13,3);
  wemng     : abap.dec(13,3);
  amein     : abap.unit(3);
  dwerk     : abap.char(4);
  lgort     : abap.char(4);
  charg     : abap.char(10);
  kdauf     : abap.char(10);
  kdpos     : abap.numc(6);
  verid     : abap.char(4);
  elikz     : abap.char(1);
  dauat     : abap.char(20);
  ltrmi     : abap.dats;
  meins     : abap.unit(3);
  pwerk     : abap.char(20);
}
