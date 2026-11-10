@EndUserText.label : 'DMS document info record'
define table draw {
  key mandt  : abap.clnt not null;
  key dokar  : abap.char(3) not null;
  key doknr  : abap.char(25) not null;
  key dokvr  : abap.char(2) not null;
  key doktl  : abap.char(3) not null;
  dktxt      : abap.char(40);
  dokst      : abap.char(20);
  dwnam      : abap.char(20);
  adatum     : abap.dats;
  dokob      : abap.char(10);
}
