@EndUserText.label : 'Background job header'
define table tbtco {
  key mandt     : abap.clnt not null;
  key jobname   : abap.char(32) not null;
  key jobcount  : abap.char(8) not null;
  status        : abap.char(2);
  sdlstrtdt     : abap.dats;
  strtdate      : abap.dats;
  enddate       : abap.dats;
  sdluname      : abap.char(40);
  endtime       : abap.tims;
  progname      : abap.char(40);
  reluname      : abap.char(40);
  sdlstrttm     : abap.tims;
  strttime      : abap.tims;
}
