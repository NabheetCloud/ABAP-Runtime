@EndUserText.label : 'Products (storage location data and stock)'
define table mard {
  key mandt : abap.clnt not null;
  key matnr : abap.char(40) not null;
  key werks : abap.char(4) not null;
  key lgort : abap.char(4) not null;
  labst     : abap.quan(13,3);
  insme     : abap.quan(13,3);
  speme     : abap.quan(13,3);
  lgpbe     : abap.char(10);
  lvorm     : abap.char(1);
  umlme     : abap.dec(13,3);
  diskz     : abap.char(20);
  kzill     : abap.char(20);
}
