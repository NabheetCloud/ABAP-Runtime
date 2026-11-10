@EndUserText.label : 'Financial statement version: account assignments'
define table fagl_011zc {
  key mandt : abap.clnt not null;
  key versn : abap.char(4) not null;
  key ergsl : abap.char(10) not null;
  key vonkt : abap.char(10) not null;
  biskt     : abap.char(20);
}
