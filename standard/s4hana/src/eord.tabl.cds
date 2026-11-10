@EndUserText.label : 'Source list'
define table eord {
  key mandt : abap.clnt not null;
  key matnr : abap.char(40) not null;
  key werks : abap.char(4) not null;
  key zeord : abap.numc(5) not null;
  vdatu     : abap.dats;
  bdatu     : abap.dats;
  lifnr     : abap.char(10);
  ekorg     : abap.char(4);
  ebeln     : abap.char(10);
  ebelp     : abap.numc(5);
  flifn     : abap.char(1);
  notkz     : abap.char(1);
  erdat     : abap.dats;
  ernam     : abap.char(12);
}
