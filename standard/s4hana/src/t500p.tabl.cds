@EndUserText.label : 'T500P'
define table t500p {
  key mandt : abap.clnt not null;
  key persa : abap.char(20) not null;
  name1     : abap.char(35);
  bukrs     : abap.char(4);
  land1     : abap.char(3);
  ort01     : abap.char(35);
}
