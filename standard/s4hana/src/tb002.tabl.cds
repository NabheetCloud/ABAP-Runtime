@EndUserText.label : 'Business partner grouping texts'
define table tb002 {
  key mandt    : abap.clnt not null;
  key spras    : abap.lang not null;
  key bu_group : abap.char(4) not null;
  txt40        : abap.char(40);
}
