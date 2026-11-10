@EndUserText.label : 'Incoterms texts'
define table tinct {
  key mandt : abap.clnt not null;
  key spras : abap.lang not null;
  key inco1 : abap.char(3) not null;
  bezei     : abap.char(30);
}
