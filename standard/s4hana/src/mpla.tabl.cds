@EndUserText.label : 'Maintenance plan'
define table mpla {
  key mandt : abap.clnt not null;
  key warpl : abap.char(12) not null;
  wptxt     : abap.char(40);
  strat     : abap.char(6);
  mptyp     : abap.char(20);
  abrho     : abap.int4;
  erdat     : abap.dats;
  ernam     : abap.char(12);
  hunit     : abap.char(20);
}
