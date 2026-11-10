@EndUserText.label : 'Physical inventory header'
define table ikpf {
  key mandt : abap.clnt not null;
  key iblnr : abap.char(10) not null;
  key gjahr : abap.numc(4) not null;
  werks     : abap.char(4);
  lgort     : abap.char(4);
  gidat     : abap.dats;
  zldat     : abap.dats;
  dstat     : abap.char(1);
  budat     : abap.dats;
  usnam     : abap.char(12);
}
