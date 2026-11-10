@EndUserText.label : 'Vendor confirmations'
define table ekes {
  key mandt : abap.clnt not null;
  key ebeln : abap.char(10) not null;
  key ebelp : abap.numc(5) not null;
  key etens : abap.numc(4) not null;
  ebtyp     : abap.char(20);
  eindt     : abap.dats;
  menge     : abap.dec(13,3);
  vbeln     : abap.char(10);
  erdat     : abap.dats;
}
