@EndUserText.label : 'Batch (plant)'
define table mcha {
  key mandt : abap.clnt not null;
  key matnr : abap.char(40) not null;
  key werks : abap.char(4) not null;
  key charg : abap.char(10) not null;
  vfdat     : abap.dats;
  hsdat     : abap.dats;
  ernam     : abap.char(12);
  ersda     : abap.dats;
}
