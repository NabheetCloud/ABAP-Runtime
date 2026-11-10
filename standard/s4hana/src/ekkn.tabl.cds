@EndUserText.label : 'PO account assignment'
define table ekkn {
  key mandt      : abap.clnt not null;
  key ebeln      : abap.char(10) not null;
  key ebelp      : abap.numc(5) not null;
  key zekkn      : abap.numc(2) not null;
  sakto          : abap.char(10);
  kostl          : abap.char(10);
  aufnr          : abap.char(12);
  ps_psp_pnr     : abap.char(8);
  anln1          : abap.char(12);
  vbeln          : abap.char(10);
  vbelp          : abap.numc(6);
  prctr          : abap.char(10);
  anln2          : abap.char(4);
  menge          : abap.dec(13,3);
  vproz          : abap.char(20);
}
