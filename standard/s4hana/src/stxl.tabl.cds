@EndUserText.label : 'SAPscript text lines (compressed)'
define table stxl {
  key mandt    : abap.clnt not null;
  key relid    : abap.char(2) not null;
  key tdobject : abap.char(10) not null;
  key tdname   : abap.char(70) not null;
  key tdid     : abap.char(4) not null;
  key tdspras  : abap.lang not null;
  key srtf2    : abap.char(20) not null;
  clustd       : abap.char(255);
  clustr       : abap.int4;
}
