@EndUserText.label : 'Set values'
define table setleaf {
  key mandt     : abap.clnt not null;
  key setclass  : abap.char(4) not null;
  key subclass  : abap.char(12) not null;
  key setname   : abap.char(24) not null;
  key lineid    : abap.char(10) not null;
  valfrom       : abap.char(24);
  valto         : abap.char(24);
  valsign       : abap.char(1);
  valoption     : abap.char(2);
}
