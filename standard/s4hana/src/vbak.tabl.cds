@EndUserText.label : 'Sales document header (inquiry, quotation, order, contract)'
define table vbak {
  key mandt : abap.clnt not null;
  key vbeln : abap.char(10) not null;
  auart     : abap.char(4);
  vbtyp     : abap.char(4);
  vkorg     : abap.char(4);
  vtweg     : abap.char(2);
  spart     : abap.char(2);
  vkbur     : abap.char(4);
  vkgrp     : abap.char(3);
  kunnr     : abap.char(10);
  erdat     : abap.dats;
  erzet     : abap.tims;
  ernam     : abap.char(12);
  audat     : abap.dats;
  vdatu     : abap.dats;
  bstnk     : abap.char(20);
  bstdk     : abap.char(20);
  @Semantics.amount.currencyCode : 'vbak.waerk'
  netwr     : abap.curr(15,2);
  waerk     : abap.cuky;
  knumv     : abap.char(10);
  vsbed     : abap.char(2);
  augru     : abap.char(20);
  lifsk     : abap.char(2);
  faksk     : abap.char(20);
  gbstk     : abap.char(1);
  abstk     : abap.char(1);
  cmgst     : abap.char(1);
  bestk     : abap.char(1);
  lfstk     : abap.char(1);
  fksak     : abap.char(1);
  fkstk     : abap.char(1);
  autlf     : abap.char(1);
}
