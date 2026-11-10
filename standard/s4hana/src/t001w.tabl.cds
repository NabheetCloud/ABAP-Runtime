@EndUserText.label : 'Plants'
define table t001w {
  key mandt : abap.clnt not null;
  key werks : abap.char(4) not null;
  name1     : abap.char(30);
  bwkey     : abap.char(4);
  kunnr     : abap.char(10);
  lifnr     : abap.char(10);
  fabkl     : abap.char(2);
  stras     : abap.char(30);
  pstlz     : abap.char(10);
  ort01     : abap.char(25);
  land1     : abap.char(3);
  regio     : abap.char(3);
  ekorg     : abap.char(4);
  vkorg     : abap.char(4);
  vtweg     : abap.char(2);
  spart     : abap.char(2);
  spras     : abap.lang;
  adrnr     : abap.char(10);
  vlfkz     : abap.char(1);
}
