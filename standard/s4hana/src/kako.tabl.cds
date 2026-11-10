@EndUserText.label : 'Capacity header'
define table kako {
  key mandt : abap.clnt not null;
  key kapid : abap.char(8) not null;
  kapar     : abap.char(20);
  begzt     : abap.dec(15,3);
  endzt     : abap.dec(15,3);
  ngrad     : abap.int4;
  aznor     : abap.int4;
  ktext     : abap.char(40);
  name      : abap.char(40);
}
