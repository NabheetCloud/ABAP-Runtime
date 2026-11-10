@EndUserText.label : 'PR account assignment'
define table ebkn {
  key mandt      : abap.clnt not null;
  key banfn      : abap.char(10) not null;
  key bnfpo      : abap.numc(5) not null;
  key zebkn      : abap.numc(2) not null;
  kostl          : abap.char(10);
  aufnr          : abap.char(12);
  ps_psp_pnr     : abap.char(8);
  sakto          : abap.char(10);
}
