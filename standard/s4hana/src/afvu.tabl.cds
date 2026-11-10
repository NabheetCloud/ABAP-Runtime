@EndUserText.label : 'AFVU'
define table afvu {
  key mandt : abap.clnt not null;
  key aufpl : abap.numc(10) not null;
  key aplzl : abap.numc(8) not null;
  usr00     : abap.char(20);
  usr01     : abap.char(20);
  usr04     : abap.char(20);
  use04     : abap.char(20);
  usr08     : abap.char(20);
}
