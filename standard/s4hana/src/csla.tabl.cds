@EndUserText.label : 'Activity types'
define table csla {
  key mandt : abap.clnt not null;
  key kokrs : abap.char(4) not null;
  key lstar : abap.char(6) not null;
  key datbi : abap.dats not null;
  leinh     : abap.char(20);
  kstar     : abap.char(20);
  datab     : abap.dats;
  ktext     : abap.char(40);
  latyp     : abap.char(20);
}
