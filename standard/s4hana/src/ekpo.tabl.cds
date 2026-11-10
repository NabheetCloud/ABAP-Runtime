@EndUserText.label : 'Purchasing document item'
define table ekpo {
  key mandt : abap.clnt not null;
  key ebeln : abap.char(10) not null;
  key ebelp : abap.numc(5) not null;
  matnr     : abap.char(40);
  txz01     : abap.char(40);
  werks     : abap.char(4);
  lgort     : abap.char(4);
  matkl     : abap.char(9);
  @Semantics.quantity.unitOfMeasure : 'ekpo.meins'
  menge     : abap.quan(13,3);
  meins     : abap.unit(3);
  netpr     : abap.dec(15,2);
  peinh     : abap.dec(15,3);
  netwr     : abap.dec(15,2);
  brtwr     : abap.dec(15,2);
  pstyp     : abap.char(20);
  knttp     : abap.char(1);
  elikz     : abap.char(1);
  erekz     : abap.char(1);
  wepos     : abap.char(1);
  repos     : abap.char(1);
  webre     : abap.char(1);
  mwskz     : abap.char(2);
  banfn     : abap.char(10);
  bnfpo     : abap.numc(5);
  konnr     : abap.char(10);
  ktpnr     : abap.numc(5);
  infnr     : abap.char(10);
  loekz     : abap.char(1);
  bprme     : abap.unit(3);
  ematn     : abap.char(20);
  retpo     : abap.char(20);
  aedat     : abap.dats;
  prdat     : abap.dats;
}
