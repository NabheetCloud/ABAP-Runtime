@EndUserText.label : 'SAPscript text header'
define table stxh {
  key mandt    : abap.clnt not null;
  key tdobject : abap.char(10) not null;
  key tdname   : abap.char(70) not null;
  key tdid     : abap.char(4) not null;
  key tdspras  : abap.lang not null;
  tdfuser      : abap.char(20);
  tdfdate      : abap.dats;
  tdltxtl      : abap.char(40);
  tdtitle      : abap.char(40);
}
