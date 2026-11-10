@EndUserText.label : 'Suppliers (general data)'
define table lfa1 {
  key mandt : abap.clnt not null;
  key lifnr : abap.char(10) not null;
  name1     : abap.char(35);
  name2     : abap.char(35);
  ort01     : abap.char(35);
  pstlz     : abap.char(10);
  stras     : abap.char(35);
  land1     : abap.char(3);
  regio     : abap.char(3);
  spras     : abap.lang;
  telf1     : abap.char(16);
  stcd1     : abap.char(16);
  stceg     : abap.char(20);
  ktokk     : abap.char(4);
  adrnr     : abap.char(10);
  loevm     : abap.char(1);
  sperr     : abap.char(1);
  erdat     : abap.dats;
  ernam     : abap.char(12);
  kunnr     : abap.char(10);
  stcd3     : abap.char(20);
}
