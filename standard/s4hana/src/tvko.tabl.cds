@EndUserText.label : 'Sales organizations'
define table tvko {
  key mandt : abap.clnt not null;
  key vkorg : abap.char(4) not null;
  waers     : abap.cuky;
  bukrs     : abap.char(4);
  kunnr     : abap.char(10);
}
