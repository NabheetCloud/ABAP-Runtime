@EndUserText.label : 'Sales document types'
define table tvak {
  key mandt : abap.clnt not null;
  key auart : abap.char(4) not null;
  vbtyp     : abap.char(4);
  numki     : abap.char(20);
  numke     : abap.char(20);
  bezei     : abap.char(40);
  kalvg     : abap.char(20);
}
