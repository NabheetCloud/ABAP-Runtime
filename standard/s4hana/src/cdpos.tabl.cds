@EndUserText.label : 'Change document items'
define table cdpos {
  key mandt      : abap.clnt not null;
  key objectclas : abap.char(15) not null;
  key objectid   : abap.char(90) not null;
  key changenr   : abap.char(10) not null;
  key tabname    : abap.char(30) not null;
  key tabkey     : abap.char(70) not null;
  key fname      : abap.char(30) not null;
  key chngind    : abap.char(1) not null;
  value_old      : abap.char(254);
  value_new      : abap.char(254);
  unit_new       : abap.unit(3);
  cuky_new       : abap.cuky;
}
