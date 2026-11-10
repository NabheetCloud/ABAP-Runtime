@EndUserText.label : 'Material group texts'
define table t023t {
  key mandt   : abap.clnt not null;
  key spras   : abap.lang not null;
  key matkl   : abap.char(9) not null;
  wgbez       : abap.char(20);
  wgbez60     : abap.char(60);
}
