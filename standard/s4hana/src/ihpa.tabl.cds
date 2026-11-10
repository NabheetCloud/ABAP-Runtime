@EndUserText.label : 'IHPA'
define table ihpa {
  key mandt   : abap.clnt not null;
  key objnr   : abap.char(22) not null;
  key parvw   : abap.char(2) not null;
  key counter : abap.numc(6) not null;
  parnr       : abap.numc(10);
  erdat       : abap.dats;
  ernam       : abap.char(12);
}
