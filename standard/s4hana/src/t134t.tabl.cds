@EndUserText.label : 'Material type texts'
define table t134t {
  key mandt : abap.clnt not null;
  key spras : abap.lang not null;
  key mtart : abap.char(4) not null;
  mtbez     : abap.char(25);
}
