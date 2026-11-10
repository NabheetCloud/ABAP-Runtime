@EndUserText.label : 'Chart of accounts texts'
define table t004t {
  key mandt : abap.clnt not null;
  key spras : abap.lang not null;
  key ktopl : abap.char(4) not null;
  ktplt     : abap.char(50);
}
