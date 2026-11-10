@EndUserText.label : 'Object ↔ class allocation'
define table kssk {
  key mandt : abap.clnt not null;
  key objek : abap.char(50) not null;
  key mafid : abap.char(1) not null;
  key klart : abap.char(3) not null;
  key clint : abap.char(10) not null;
  key adzhl : abap.numc(4) not null;
  datuv     : abap.dats;
  statu     : abap.char(1);
  zaehl     : abap.numc(8);
}
