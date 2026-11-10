@EndUserText.label : 'Charts of accounts'
define table t004 {
  key mandt     : abap.clnt not null;
  key ktopl     : abap.char(4) not null;
  dspra         : abap.lang;
  saknr_len     : abap.numc(2);
  maession      : abap.char(20);
}
