@EndUserText.label : 'Supplier account group texts'
define table t077y {
  key mandt : abap.clnt not null;
  key spras : abap.lang not null;
  key ktokk : abap.char(4) not null;
  txt30     : abap.char(30);
}
