@EndUserText.label : 'Time zone texts'
define table ttzzt {
  key mandt    : abap.clnt not null;
  key langu    : abap.lang not null;
  key tzone    : abap.char(6) not null;
  descript     : abap.char(50);
}
