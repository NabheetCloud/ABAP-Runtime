@EndUserText.label : 'Profit center texts'
define table cepct {
  key mandt : abap.clnt not null;
  key spras : abap.lang not null;
  key prctr : abap.char(10) not null;
  key datbi : abap.dats not null;
  key kokrs : abap.char(4) not null;
  ktext     : abap.char(20);
  ltext     : abap.char(40);
}
