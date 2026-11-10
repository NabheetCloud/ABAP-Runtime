@EndUserText.label : 'Purchasing organizations'
define table t024e {
  key mandt : abap.clnt not null;
  key ekorg : abap.char(4) not null;
  ekotx     : abap.char(20);
  bukrs     : abap.char(4);
}
