@EndUserText.label : 'BP tax numbers'
define table dfkkbptaxnum {
  key mandt   : abap.clnt not null;
  key partner : abap.char(10) not null;
  key taxtype : abap.char(4) not null;
  taxnum      : abap.char(20);
}
