@EndUserText.label : 'Maintenance notification data'
define table qmih {
  key mandt : abap.clnt not null;
  key qmnum : abap.char(12) not null;
  equnr     : abap.char(18);
  iloan     : abap.char(12);
  ausvn     : abap.dats;
  ausbs     : abap.dats;
  msaus     : abap.char(20);
  ingrp     : abap.char(3);
  iwerk     : abap.char(4);
}
