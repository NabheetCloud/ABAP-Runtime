@EndUserText.label : 'Status profile per object'
define table jsto {
  key mandt : abap.clnt not null;
  key objnr : abap.char(22) not null;
  obtyp     : abap.char(20);
  stsma     : abap.char(8);
}
