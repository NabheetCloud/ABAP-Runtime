@EndUserText.label : 'House bank accounts'
define table t012k {
  key mandt : abap.clnt not null;
  key bukrs : abap.char(4) not null;
  key hbkid : abap.char(5) not null;
  key hktid : abap.char(5) not null;
  bankn     : abap.char(18);
  waers     : abap.cuky;
  hkont     : abap.char(10);
}
