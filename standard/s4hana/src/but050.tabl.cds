@EndUserText.label : 'BP relationships'
define table but050 {
  key mandt     : abap.clnt not null;
  key relnr     : abap.char(12) not null;
  key partner1  : abap.char(10) not null;
  key partner2  : abap.char(10) not null;
  key date_to   : abap.dats not null;
  reltyp        : abap.char(6);
  date_from     : abap.dats;
}
