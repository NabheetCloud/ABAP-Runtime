@EndUserText.label : 'Customer tax indicators'
define table knvi {
  key mandt : abap.clnt not null;
  key kunnr : abap.char(10) not null;
  key aland : abap.char(3) not null;
  key tatyp : abap.char(4) not null;
  taxkd     : abap.char(1);
}
