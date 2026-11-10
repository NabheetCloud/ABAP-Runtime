@EndUserText.label : 'Financial statement version: nodes'
define table fagl_011pc {
  key mandt : abap.clnt not null;
  key versn : abap.char(4) not null;
  key ergsl : abap.char(10) not null;
  txt45     : abap.char(40);
}
