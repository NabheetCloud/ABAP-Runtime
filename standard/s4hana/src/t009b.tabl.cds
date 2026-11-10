@EndUserText.label : 'Fiscal year variant periods'
define table t009b {
  key mandt : abap.clnt not null;
  key periv : abap.char(20) not null;
  key bdatj : abap.numc(4) not null;
  key bumon : abap.numc(2) not null;
  key butag : abap.numc(2) not null;
  poper     : abap.numc(3);
  reljr     : abap.numc(2);
}
