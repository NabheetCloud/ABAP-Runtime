@EndUserText.label : 'Change document header'
define table cdhdr {
  key mandt      : abap.clnt not null;
  key objectclas : abap.char(15) not null;
  key objectid   : abap.char(90) not null;
  key changenr   : abap.char(10) not null;
  username       : abap.char(40);
  udate          : abap.dats;
  utime          : abap.tims;
  tcode          : abap.char(20);
  change_ind     : abap.char(20);
}
