@EndUserText.label : 'Ledger per company code'
define table finsc_ld_cmp {
  key mandt  : abap.clnt not null;
  key rldnr  : abap.char(2) not null;
  key bukrs  : abap.char(4) not null;
  curtph     : abap.char(20);
  curtpk     : abap.char(20);
  curtpo     : abap.char(20);
  periv      : abap.char(20);
}
