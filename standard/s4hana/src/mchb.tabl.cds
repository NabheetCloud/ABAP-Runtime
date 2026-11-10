@EndUserText.label : 'Batch stocks'
define table mchb {
  key mandt : abap.clnt not null;
  key matnr : abap.char(40) not null;
  key werks : abap.char(4) not null;
  key lgort : abap.char(4) not null;
  key charg : abap.char(10) not null;
  clabs     : abap.dec(13,3);
  cinsm     : abap.dec(13,3);
  cspem     : abap.char(20);
  ersda     : abap.dats;
}
