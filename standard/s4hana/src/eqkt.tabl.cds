@EndUserText.label : 'Equipment texts'
define table eqkt {
  key mandt : abap.clnt not null;
  key equnr : abap.char(18) not null;
  key spras : abap.lang not null;
  eqktx     : abap.char(20);
}
