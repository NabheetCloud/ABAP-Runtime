@EndUserText.label : 'User status texts'
define table tj30t {
  key mandt : abap.clnt not null;
  key stsma : abap.char(8) not null;
  key estat : abap.char(5) not null;
  key spras : abap.lang not null;
  txt04     : abap.char(40);
  txt30     : abap.char(40);
}
