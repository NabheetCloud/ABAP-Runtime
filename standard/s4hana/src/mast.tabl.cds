@EndUserText.label : 'Material ↔ BOM link'
define table mast {
  key mandt : abap.clnt not null;
  key matnr : abap.char(40) not null;
  key werks : abap.char(4) not null;
  key stlan : abap.char(1) not null;
  key stlnr : abap.char(8) not null;
  key stlal : abap.char(2) not null;
  losvn     : abap.char(20);
  losbs     : abap.char(20);
  andat     : abap.dats;
  annam     : abap.char(20);
}
