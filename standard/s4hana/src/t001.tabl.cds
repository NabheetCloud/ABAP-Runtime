@EndUserText.label : 'Company codes'
define table t001 {
  key mandt : abap.clnt not null;
  key bukrs : abap.char(4) not null;
  butxt     : abap.char(25);
  ort01     : abap.char(25);
  land1     : abap.char(3);
  waers     : abap.cuky;
  spras     : abap.lang;
  ktopl     : abap.char(4);
  periv     : abap.char(2);
  rcomp     : abap.char(6);
  adrnr     : abap.char(10);
  stceg     : abap.char(20);
  opvar     : abap.char(20);
}
