@EndUserText.label : 'Workflow container objects'
define table sww_contob {
  key mandt     : abap.clnt not null;
  key wi_id     : abap.char(12) not null;
  key element   : abap.char(32) not null;
  key tab_index : abap.numc(6) not null;
  objtype       : abap.char(20);
  objkey        : abap.char(20);
}
