@EndUserText.label : 'Currency texts'
define table tcurt {
  key mandt : abap.clnt not null;
  key spras : abap.lang not null;
  key waers : abap.cuky not null;
  ltext     : abap.char(40);
  ktext     : abap.char(15);
}
