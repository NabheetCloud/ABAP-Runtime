@EndUserText.label : 'Equipment time segment'
define table equz {
  key mandt : abap.clnt not null;
  key equnr : abap.char(18) not null;
  key datbi : abap.dats not null;
  key eqlfn : abap.numc(3) not null;
  iloan     : abap.char(12);
  hequi     : abap.char(20);
  iwerk     : abap.char(4);
  gewrk     : abap.char(8);
  datab     : abap.dats;
  tplnr     : abap.char(40);
}
