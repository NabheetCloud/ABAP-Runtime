@EndUserText.label : 'Movement type texts'
define table t156t {
  key mandt : abap.clnt not null;
  key spras : abap.lang not null;
  key bwart : abap.char(3) not null;
  btext     : abap.char(20);
}
