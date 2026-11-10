@EndUserText.label : 'Equipment master'
define table equi {
  key mandt : abap.clnt not null;
  key equnr : abap.char(18) not null;
  eqtyp     : abap.char(1);
  eqart     : abap.char(10);
  herst     : abap.char(30);
  serge     : abap.char(30);
  matnr     : abap.char(40);
  sernr     : abap.char(18);
  baujj     : abap.numc(4);
  objnr     : abap.char(22);
  inbdt     : abap.dats;
  erdat     : abap.dats;
  ernam     : abap.char(12);
}
