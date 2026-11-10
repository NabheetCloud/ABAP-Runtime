@EndUserText.label : 'MRP type texts'
define table t438t {
  key mandt : abap.clnt not null;
  key spras : abap.lang not null;
  key dismm : abap.char(2) not null;
  dibez     : abap.char(30);
}
