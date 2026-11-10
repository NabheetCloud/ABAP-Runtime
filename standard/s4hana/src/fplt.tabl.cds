@EndUserText.label : 'Billing plan dates'
define table fplt {
  key mandt : abap.clnt not null;
  key fplnr : abap.char(10) not null;
  key fpltr : abap.char(6) not null;
  afdat     : abap.dats;
  fakwr     : abap.dec(15,2);
  fksaf     : abap.char(20);
  waers     : abap.cuky;
}
