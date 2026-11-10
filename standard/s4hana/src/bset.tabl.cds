@EndUserText.label : 'Tax line items'
define table bset {
  key mandt : abap.clnt not null;
  key bukrs : abap.char(4) not null;
  key belnr : abap.char(10) not null;
  key gjahr : abap.numc(4) not null;
  key buzei : abap.numc(3) not null;
  mwskz     : abap.char(2);
  hwbas     : abap.dec(15,2);
  fwbas     : abap.dec(15,2);
  hwste     : abap.dec(15,2);
  fwste     : abap.dec(15,2);
  ktosl     : abap.char(3);
  hkont     : abap.char(10);
  kschl     : abap.char(4);
  shkzg     : abap.char(1);
}
