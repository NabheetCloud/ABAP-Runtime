@EndUserText.label : 'Measuring points'
define table imptt {
  key mandt  : abap.clnt not null;
  key point  : abap.char(12) not null;
  mpobj      : abap.char(20);
  mptyp      : abap.char(20);
  atinn      : abap.char(10);
  pointt     : abap.char(20);
  equnr      : abap.char(18);
  tplnr      : abap.char(40);
  unitc      : abap.char(20);
  indct      : abap.char(20);
  mrmax      : abap.dec(15,3);
  mrmin      : abap.dec(15,3);
  psort      : abap.char(20);
}
