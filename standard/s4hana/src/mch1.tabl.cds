@EndUserText.label : 'Batch (cross-plant)'
define table mch1 {
  key mandt : abap.clnt not null;
  key matnr : abap.char(40) not null;
  key charg : abap.char(10) not null;
  vfdat     : abap.dats;
  hsdat     : abap.dats;
  lifnr     : abap.char(10);
  licha     : abap.char(20);
  ernam     : abap.char(12);
  ersda     : abap.dats;
}
