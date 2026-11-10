@EndUserText.label : 'User logon data'
define table usr02 {
  key mandt : abap.clnt not null;
  key bname : abap.char(12) not null;
  ustyp     : abap.char(1);
  gltgv     : abap.dats;
  gltgb     : abap.dats;
  uflag     : abap.char(1);
  trdat     : abap.dats;
  ltime     : abap.tims;
  class     : abap.char(18);
}
