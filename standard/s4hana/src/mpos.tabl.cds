@EndUserText.label : 'Maintenance item'
define table mpos {
  key mandt : abap.clnt not null;
  key wapos : abap.char(16) not null;
  warpl     : abap.char(12);
  equnr     : abap.char(18);
  tplnr     : abap.char(40);
  plnty     : abap.char(1);
  plnnr     : abap.char(8);
  plnal     : abap.char(2);
  auart     : abap.char(4);
  gewrk     : abap.char(8);
  iwerk     : abap.char(4);
  pstxt     : abap.char(40);
}
