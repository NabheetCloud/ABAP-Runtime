@EndUserText.label : 'Units of measure of products'
define table marm {
  key mandt : abap.clnt not null;
  key matnr : abap.char(40) not null;
  key meinh : abap.unit(3) not null;
  umrez     : abap.dec(5,0);
  umren     : abap.dec(5,0);
  ean11     : abap.char(18);
  brgew     : abap.dec(15,3);
  volum     : abap.dec(15,3);
}
