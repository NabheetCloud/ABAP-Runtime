@EndUserText.label : 'Schedule lines'
define table eket {
  key mandt : abap.clnt not null;
  key ebeln : abap.char(10) not null;
  key ebelp : abap.numc(5) not null;
  key etenr : abap.numc(4) not null;
  eindt     : abap.dats;
  menge     : abap.dec(13,3);
  wemng     : abap.dec(13,3);
  banfn     : abap.char(10);
  bnfpo     : abap.numc(5);
  charg     : abap.char(10);
  wamng     : abap.dec(13,3);
  dabmg     : abap.char(20);
  slfdt     : abap.char(20);
}
