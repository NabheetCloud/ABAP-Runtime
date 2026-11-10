@EndUserText.label : 'Object status'
define table jest {
  key mandt : abap.clnt not null;
  key objnr : abap.char(22) not null;
  key stat  : abap.char(5) not null;
  inact     : abap.char(20);
  chgnr     : abap.char(20);
}
