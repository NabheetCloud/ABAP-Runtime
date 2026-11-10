@EndUserText.label : 'Product descriptions'
define table makt {
  key mandt : abap.clnt not null;
  key matnr : abap.char(40) not null;
  key spras : abap.lang not null;
  maktx     : abap.char(40);
  maktg     : abap.char(20);
}
