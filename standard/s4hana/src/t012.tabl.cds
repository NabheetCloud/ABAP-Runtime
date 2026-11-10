@EndUserText.label : 'House banks'
define table t012 {
  key mandt : abap.clnt not null;
  key bukrs : abap.char(4) not null;
  key hbkid : abap.char(5) not null;
  banks     : abap.char(3);
  bankl     : abap.char(15);
}
