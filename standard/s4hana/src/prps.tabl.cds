@EndUserText.label : 'WBS element master'
define table prps {
  key mandt : abap.clnt not null;
  key pspnr : abap.char(8) not null;
  posid     : abap.char(24);
  psphi     : abap.char(8);
  objnr     : abap.char(22);
  pbukr     : abap.char(20);
  prctr     : abap.char(10);
  stufe     : abap.int4;
  astnr     : abap.char(20);
  belkz     : abap.char(20);
  erdat     : abap.dats;
  ernam     : abap.char(12);
  fakkz     : abap.char(20);
  pkokr     : abap.char(20);
  plakz     : abap.char(20);
  post1     : abap.char(40);
  werks     : abap.char(4);
}
