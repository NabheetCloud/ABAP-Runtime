@EndUserText.label : 'Inspection characteristic specs'
define table qamv {
  key mandt      : abap.clnt not null;
  key prueflos   : abap.char(12) not null;
  key vorglfnr   : abap.numc(8) not null;
  key merknr     : abap.numc(4) not null;
  verwmerkm      : abap.char(20);
  kurztext       : abap.char(40);
  sollwert       : abap.dec(13,3);
  toleranzob     : abap.dec(15,3);
  toleranzun     : abap.dec(15,3);
  masseinhsw     : abap.char(20);
  steuerkz       : abap.char(20);
  stichprver     : abap.char(20);
}
