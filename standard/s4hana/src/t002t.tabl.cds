@EndUserText.label : 'Language texts'
define table t002t {
  key mandt : abap.clnt not null;
  key spras : abap.lang not null;
  key sprsl : abap.lang not null;
  sptxt     : abap.char(16);
}
