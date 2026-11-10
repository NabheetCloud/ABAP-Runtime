@EndUserText.label : 'Region texts'
define table t005u {
  key mandt : abap.clnt not null;
  key spras : abap.lang not null;
  key land1 : abap.char(3) not null;
  key bland : abap.char(3) not null;
  bezei     : abap.char(20);
}
