@EndUserText.label : 'Supplier invoice item'
define table rseg {
  key mandt : abap.clnt not null;
  key belnr : abap.char(10) not null;
  key gjahr : abap.numc(4) not null;
  key buzei : abap.numc(3) not null;
  ebeln     : abap.char(10);
  ebelp     : abap.numc(5);
  matnr     : abap.char(40);
  werks     : abap.char(4);
  wrbtr     : abap.dec(15,2);
  @Semantics.quantity.unitOfMeasure : 'rseg.bstme'
  menge     : abap.quan(13,3);
  bstme     : abap.unit(3);
  mwskz     : abap.char(2);
  lfbnr     : abap.char(10);
  lfgja     : abap.numc(4);
  lfpos     : abap.numc(4);
  @Semantics.quantity.unitOfMeasure : 'rseg.bstme'
  bpmng     : abap.quan(13,3);
  shkzg     : abap.char(1);
  bukrs     : abap.char(4);
  kschl     : abap.char(4);
}
