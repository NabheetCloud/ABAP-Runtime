@EndUserText.label : 'Entry view line items (open-item managed, still filled)'
define table bseg {
  key mandt   : abap.clnt not null;
  key bukrs   : abap.char(4) not null;
  key belnr   : abap.char(10) not null;
  key gjahr   : abap.numc(4) not null;
  key buzei   : abap.numc(3) not null;
  bschl       : abap.char(2);
  koart       : abap.char(1);
  shkzg       : abap.char(1);
  dmbtr       : abap.dec(15,2);
  wrbtr       : abap.dec(15,2);
  hkont       : abap.char(10);
  kunnr       : abap.char(10);
  lifnr       : abap.char(10);
  umskz       : abap.char(1);
  mwskz       : abap.char(2);
  zuonr       : abap.char(18);
  sgtxt       : abap.char(50);
  kostl       : abap.char(10);
  aufnr       : abap.char(12);
  prctr       : abap.char(10);
  augbl       : abap.char(10);
  augdt       : abap.dats;
  zfbdt       : abap.dats;
  zterm       : abap.char(4);
  zbd1t       : abap.char(20);
  matnr       : abap.char(40);
  werks       : abap.char(4);
  @Semantics.quantity.unitOfMeasure : 'bseg.meins'
  menge       : abap.quan(13,3);
  meins       : abap.unit(3);
  ebeln       : abap.char(10);
  ebelp       : abap.numc(5);
  anln1       : abap.char(12);
  anln2       : abap.char(4);
  zlsch       : abap.char(20);
  vbeln       : abap.char(10);
  h_blart     : abap.char(20);
  h_bldat     : abap.dats;
  h_budat     : abap.dats;
  h_waers     : abap.char(20);
  segment     : abap.char(10);
}
