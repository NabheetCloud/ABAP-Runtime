@EndUserText.label : 'Location / account assignment'
define table iloa {
  key mandt : abap.clnt not null;
  key iloan : abap.char(12) not null;
  tplnr     : abap.char(40);
  swerk     : abap.char(4);
  stort     : abap.char(10);
  kostl     : abap.char(10);
  bukrs     : abap.char(4);
  anlnr     : abap.char(20);
  gsber     : abap.char(4);
  msgrp     : abap.char(8);
  beber     : abap.char(3);
  abckz     : abap.char(20);
}
