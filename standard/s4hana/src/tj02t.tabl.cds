@EndUserText.label : 'System status texts'
define table tj02t {
  key mandt : abap.clnt not null;
  key istat : abap.char(5) not null;
  key spras : abap.lang not null;
  txt04     : abap.char(40);
  txt30     : abap.char(40);
}
