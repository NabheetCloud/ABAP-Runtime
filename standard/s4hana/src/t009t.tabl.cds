@EndUserText.label : 'Fiscal year variant texts'
define table t009t {
  key mandt : abap.clnt not null;
  key spras : abap.lang not null;
  key periv : abap.char(2) not null;
  ltext     : abap.char(30);
}
