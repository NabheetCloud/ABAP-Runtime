@EndUserText.label : 'PO history'
define table ekbe {
  key mandt : abap.clnt not null;
  key ebeln : abap.char(10) not null;
  key ebelp : abap.numc(5) not null;
  key zekkn : abap.numc(2) not null;
  key vgabe : abap.char(1) not null;
  key gjahr : abap.numc(4) not null;
  key belnr : abap.char(10) not null;
  key buzei : abap.numc(3) not null;
  bewtp     : abap.char(1);
  bwart     : abap.char(3);
  budat     : abap.dats;
  menge     : abap.dec(13,3);
  dmbtr     : abap.dec(15,2);
  wrbtr     : abap.dec(15,2);
  shkzg     : abap.char(1);
  lfbnr     : abap.char(10);
  lfgja     : abap.numc(4);
  lfpos     : abap.numc(4);
  cpudt     : abap.dats;
  ernam     : abap.char(12);
  matnr     : abap.char(40);
  waers     : abap.cuky;
  werks     : abap.char(4);
}
