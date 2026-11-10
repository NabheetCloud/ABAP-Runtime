@EndUserText.label : 'Reservations / dependent requirements'
define table resb {
  key mandt : abap.clnt not null;
  key rsnum : abap.char(10) not null;
  key rspos : abap.numc(4) not null;
  key rsart : abap.char(1) not null;
  matnr     : abap.char(40);
  werks     : abap.char(4);
  lgort     : abap.char(4);
  bdmng     : abap.dec(13,3);
  enmng     : abap.dec(13,3);
  bdter     : abap.dats;
  aufnr     : abap.char(12);
  bwart     : abap.char(3);
  xloek     : abap.char(1);
  kzear     : abap.char(1);
  meins     : abap.unit(3);
  posnr     : abap.numc(6);
  postp     : abap.char(1);
  schgt     : abap.char(20);
}
