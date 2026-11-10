@EndUserText.label : 'Invoice account assignment'
define table rbco {
  key mandt   : abap.clnt not null;
  key belnr   : abap.char(10) not null;
  key gjahr   : abap.numc(4) not null;
  key buzei   : abap.numc(3) not null;
  key cobl_nr : abap.numc(4) not null;
  saknr       : abap.char(10);
  kostl       : abap.char(10);
  aufnr       : abap.char(12);
  bstme       : abap.unit(3);
  @Semantics.quantity.unitOfMeasure : 'rbco.bstme'
  menge       : abap.quan(13,3);
  mwskz       : abap.char(2);
  shkzg       : abap.char(1);
  wrbtr       : abap.dec(15,2);
}
