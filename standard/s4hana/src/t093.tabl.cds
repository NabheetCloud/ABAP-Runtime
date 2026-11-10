@EndUserText.label : 'Depreciation areas / company code settings'
define table t093 {
  key mandt  : abap.clnt not null;
  key afapl  : abap.char(4) not null;
  key afaber : abap.char(2) not null;
  bukrs      : abap.char(4);
  afbez      : abap.char(40);
}
