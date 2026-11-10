@EndUserText.label : 'Work center header'
define table crhd {
  key mandt : abap.clnt not null;
  key objty : abap.char(2) not null;
  key objid : abap.char(8) not null;
  arbpl     : abap.char(8);
  werks     : abap.char(4);
  verwe     : abap.char(20);
  veran     : abap.char(20);
  begda     : abap.dats;
  endda     : abap.dats;
  kapid     : abap.char(8);
  ktext     : abap.char(40);
}
