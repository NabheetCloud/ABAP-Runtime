@EndUserText.label : 'Plant ↔ purchasing org'
define table t024w {
  key mandt : abap.clnt not null;
  key werks : abap.char(4) not null;
  key ekorg : abap.char(4) not null;
}
