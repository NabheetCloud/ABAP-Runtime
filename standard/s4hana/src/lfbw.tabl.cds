@EndUserText.label : 'Supplier withholding tax'
define table lfbw {
  key mandt     : abap.clnt not null;
  key lifnr     : abap.char(10) not null;
  key bukrs     : abap.char(4) not null;
  key witht     : abap.char(2) not null;
  wt_withcd     : abap.char(2);
  wt_subjct     : abap.char(20);
}
