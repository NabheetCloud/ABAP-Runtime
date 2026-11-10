@EndUserText.label : 'Planned order'
define table plaf {
  key mandt : abap.clnt not null;
  key plnum : abap.char(10) not null;
  matnr     : abap.char(40);
  plwrk     : abap.char(20);
  pwwrk     : abap.char(20);
  gsmng     : abap.dec(13,3);
  psttr     : abap.dats;
  pedtr     : abap.dats;
  paart     : abap.char(4);
  beskz     : abap.char(20);
  verid     : abap.char(4);
  dispo     : abap.char(20);
  meins     : abap.unit(3);
  trmer     : abap.char(20);
}
