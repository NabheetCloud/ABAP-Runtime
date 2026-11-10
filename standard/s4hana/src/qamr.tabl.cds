@EndUserText.label : 'Characteristic results'
define table qamr {
  key mandt      : abap.clnt not null;
  key prueflos   : abap.char(12) not null;
  key vorglfnr   : abap.numc(8) not null;
  key merknr     : abap.numc(4) not null;
  mittelwert     : abap.dec(15,3);
  anzfehler      : abap.char(20);
  mbewertg       : abap.char(20);
  attribut       : abap.char(20);
  anzwertg       : abap.int4;
  pruefdatuv     : abap.dats;
  pruefer        : abap.char(20);
}
