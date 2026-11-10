@EndUserText.label : 'Contact persons'
define table knvk {
  key mandt : abap.clnt not null;
  key parnr : abap.numc(10) not null;
  kunnr     : abap.char(10);
  namev     : abap.char(35);
  name1     : abap.char(35);
  abtnr     : abap.char(4);
  pafkt     : abap.char(2);
}
