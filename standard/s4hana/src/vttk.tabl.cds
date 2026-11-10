@EndUserText.label : 'Shipment header'
define table vttk {
  key mandt : abap.clnt not null;
  key tknum : abap.char(10) not null;
  tpnum     : abap.numc(4);
  shtyp     : abap.char(4);
  tdlnr     : abap.char(10);
  dtabf     : abap.char(20);
  vbeln     : abap.char(10);
  erdat     : abap.dats;
  ernam     : abap.char(12);
  stabf     : abap.char(20);
  stdis     : abap.char(20);
  stlbg     : abap.char(20);
  streg     : abap.char(20);
  tplst     : abap.char(4);
}
