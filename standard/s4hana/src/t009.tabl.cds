@EndUserText.label : 'Fiscal year variants'
define table t009 {
  key mandt : abap.clnt not null;
  key periv : abap.char(2) not null;
  anzbp     : abap.numc(3);
  anzsp     : abap.numc(2);
  xkale     : abap.char(1);
}
