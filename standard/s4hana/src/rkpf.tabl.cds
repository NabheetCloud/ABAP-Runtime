@EndUserText.label : 'Reservation header'
define table rkpf {
  key mandt : abap.clnt not null;
  key rsnum : abap.char(10) not null;
  bdter     : abap.dats;
  kostl     : abap.char(10);
  aufnr     : abap.char(12);
  bwart     : abap.char(3);
  rsdat     : abap.dats;
  usnam     : abap.char(12);
}
