@EndUserText.label : 'Suppliers (purchasing organization data)'
define table lfm1 {
  key mandt : abap.clnt not null;
  key lifnr : abap.char(10) not null;
  key ekorg : abap.char(4) not null;
  waers     : abap.cuky;
  zterm     : abap.char(4);
  inco1     : abap.char(3);
  inco2     : abap.char(28);
  webre     : abap.char(1);
  verkf     : abap.char(30);
  telf1     : abap.char(16);
  loevm     : abap.char(1);
  kalsk     : abap.char(20);
  sperm     : abap.char(20);
}
