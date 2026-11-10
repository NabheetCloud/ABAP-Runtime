@EndUserText.label : 'Accounting document types'
define table t003 {
  key mandt : abap.clnt not null;
  key blart : abap.char(2) not null;
  numkr     : abap.char(20);
  koars     : abap.char(20);
  ltext     : abap.char(40);
}
