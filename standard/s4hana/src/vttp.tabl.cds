@EndUserText.label : 'Shipment items'
define table vttp {
  key mandt : abap.clnt not null;
  key tknum : abap.char(10) not null;
  key tpnum : abap.numc(4) not null;
  shtyp     : abap.char(4);
  tdlnr     : abap.char(10);
  dtabf     : abap.char(20);
  vbeln     : abap.char(10);
}
