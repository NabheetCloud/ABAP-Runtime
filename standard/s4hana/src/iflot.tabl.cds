@EndUserText.label : 'Functional location'
define table iflot {
  key mandt : abap.clnt not null;
  key tplnr : abap.char(40) not null;
  fltyp     : abap.char(20);
  iwerk     : abap.char(4);
  swerk     : abap.char(4);
  tplma     : abap.char(20);
  objnr     : abap.char(22);
  iloan     : abap.char(12);
  stort     : abap.char(10);
  beber     : abap.char(3);
  ingrp     : abap.char(3);
  erdat     : abap.dats;
  ernam     : abap.char(12);
}
