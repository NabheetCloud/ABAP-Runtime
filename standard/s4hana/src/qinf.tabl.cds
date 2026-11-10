@EndUserText.label : 'Q-info record (procurement)'
define table qinf {
  key mandt     : abap.clnt not null;
  key matnr     : abap.char(40) not null;
  key lieferant : abap.char(10) not null;
  key werk      : abap.char(4) not null;
  frei_dat      : abap.dats;
  noinsp        : abap.char(20);
  sperrfkt      : abap.char(20);
  zertifkat     : abap.char(20);
}
