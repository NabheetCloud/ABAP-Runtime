@EndUserText.label : 'Customer account group texts'
define table t077x {
  key mandt : abap.clnt not null;
  key spras : abap.lang not null;
  key ktokd : abap.char(4) not null;
  txt30     : abap.char(30);
}
