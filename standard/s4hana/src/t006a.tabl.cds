@EndUserText.label : 'Unit of measure texts'
define table t006a {
  key mandt : abap.clnt not null;
  key spras : abap.lang not null;
  key msehi : abap.unit(3) not null;
  mseh3     : abap.char(3);
  mseh6     : abap.char(6);
  msehl     : abap.char(30);
}
