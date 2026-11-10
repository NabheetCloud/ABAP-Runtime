@EndUserText.label : 'G/L account group texts'
define table t077z {
  key mandt : abap.clnt not null;
  key spras : abap.lang not null;
  key ktopl : abap.char(4) not null;
  key ktoks : abap.char(4) not null;
  txt30     : abap.char(30);
}
