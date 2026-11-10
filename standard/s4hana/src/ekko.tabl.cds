@EndUserText.label : 'Purchasing document header (PO, contract, scheduling agreement, RFQ)'
define table ekko {
  key mandt : abap.clnt not null;
  key ebeln : abap.char(10) not null;
  bukrs     : abap.char(4);
  bstyp     : abap.char(1);
  bsart     : abap.char(4);
  lifnr     : abap.char(10);
  ekorg     : abap.char(4);
  ekgrp     : abap.char(3);
  bedat     : abap.dats;
  waers     : abap.cuky;
  zterm     : abap.char(4);
  inco1     : abap.char(3);
  knumv     : abap.char(10);
  frgke     : abap.char(20);
  statu     : abap.char(1);
  loekz     : abap.char(1);
  aedat     : abap.dats;
  ernam     : abap.char(12);
  kdatb     : abap.dats;
  kdate     : abap.dats;
  inco2     : abap.char(28);
  adrnr     : abap.char(10);
  spras     : abap.lang;
  wkurs     : abap.dec(15,3);
}
