@EndUserText.label : 'Cost center texts'
define table cskt {
  key mandt : abap.clnt not null;
  key spras : abap.lang not null;
  key kokrs : abap.char(4) not null;
  key kostl : abap.char(10) not null;
  key datbi : abap.dats not null;
  ktext     : abap.char(20);
  ltext     : abap.char(40);
}
