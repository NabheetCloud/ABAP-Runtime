@EndUserText.label : 'Valuation areas'
define table t001k {
  key mandt : abap.clnt not null;
  key bwkey : abap.char(4) not null;
  bukrs     : abap.char(4);
  mlbwa     : abap.char(20);
}
