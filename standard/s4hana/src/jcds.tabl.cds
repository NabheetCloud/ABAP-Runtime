@EndUserText.label : 'Status change history'
define table jcds {
  key mandt   : abap.clnt not null;
  key objnr   : abap.char(22) not null;
  key stat    : abap.char(5) not null;
  key chgnr   : abap.char(20) not null;
  udate       : abap.dats;
  utime       : abap.tims;
  usnam       : abap.char(12);
  inact       : abap.char(20);
  cdtcode     : abap.char(20);
}
