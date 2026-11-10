@EndUserText.label : 'BOM item'
define table stpo {
  key mandt : abap.clnt not null;
  key stlty : abap.char(1) not null;
  key stlnr : abap.char(8) not null;
  key stlkn : abap.numc(8) not null;
  key stpoz : abap.numc(8) not null;
  key bom   : abap.char(20) not null;
  idnrk     : abap.char(40);
  posnr     : abap.numc(6);
  postp     : abap.char(1);
  @Semantics.quantity.unitOfMeasure : 'stpo.meins'
  menge     : abap.quan(13,3);
  meins     : abap.unit(3);
  datuv     : abap.dats;
  ausch     : abap.dec(15,3);
  sanka     : abap.char(20);
  lgort     : abap.char(4);
  alpgr     : abap.char(20);
  andat     : abap.dats;
  annam     : abap.char(20);
}
