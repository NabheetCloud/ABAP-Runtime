@EndUserText.label : 'Products (plant data)'
define table marc {
  key mandt : abap.clnt not null;
  key matnr : abap.char(40) not null;
  key werks : abap.char(4) not null;
  ekgrp     : abap.char(3);
  dismm     : abap.char(2);
  dispo     : abap.char(3);
  beskz     : abap.char(1);
  plifz     : abap.dec(3,0);
  minbe     : abap.quan(13,3);
  eisbe     : abap.quan(13,3);
  prctr     : abap.char(10);
  mmsta     : abap.char(2);
  lvorm     : abap.char(1);
  sobsl     : abap.char(20);
  webaz     : abap.dec(15,3);
  bstmi     : abap.dec(13,3);
  bstma     : abap.dec(13,3);
  xchpf     : abap.char(1);
  ladgr     : abap.char(20);
  stawn     : abap.char(20);
}
