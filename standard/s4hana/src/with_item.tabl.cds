@EndUserText.label : 'Withholding tax items'
define table with_item {
  key mandt     : abap.clnt not null;
  key bukrs     : abap.char(4) not null;
  key belnr     : abap.char(10) not null;
  key gjahr     : abap.numc(4) not null;
  key buzei     : abap.numc(3) not null;
  key witht     : abap.char(2) not null;
  wt_withcd     : abap.char(2);
  wt_qsshh      : abap.dec(15,2);
  wt_qbshh      : abap.dec(15,2);
  wt_qsshb      : abap.dec(15,2);
}
