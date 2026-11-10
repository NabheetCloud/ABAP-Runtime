@EndUserText.label : 'Billing plan'
define table fpla {
  key mandt : abap.clnt not null;
  key fplnr : abap.char(10) not null;
  fpltr     : abap.char(6);
  afdat     : abap.dats;
  fakwr     : abap.dec(15,2);
  fksaf     : abap.char(20);
  bedat     : abap.dats;
  endat     : abap.dats;
  fpart     : abap.char(20);
  horiz     : abap.char(20);
}
