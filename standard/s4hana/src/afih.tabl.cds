@EndUserText.label : 'Maintenance order header'
define table afih {
  key mandt : abap.clnt not null;
  key aufnr : abap.char(12) not null;
  equnr     : abap.char(18);
  iloan     : abap.char(12);
  iwerk     : abap.char(4);
  ingpr     : abap.char(20);
  qmnum     : abap.char(12);
  warpl     : abap.char(12);
  abnum     : abap.numc(4);
  priok     : abap.char(20);
  ilart     : abap.char(20);
  tplnr     : abap.char(40);
  ingrp     : abap.char(3);
  gewrk     : abap.char(8);
  gstrp     : abap.dats;
  gltrp     : abap.dats;
}
