@EndUserText.label : 'BP bank details'
define table but0bk {
  key mandt   : abap.clnt not null;
  key partner : abap.char(10) not null;
  key bkvid   : abap.char(4) not null;
  banks       : abap.char(3);
  bankl       : abap.char(15);
  bankn       : abap.char(18);
  bkont       : abap.char(10);
  iban        : abap.char(34);
}
