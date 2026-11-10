@EndUserText.label : 'Business partner groupings'
define table tb001 {
  key mandt    : abap.clnt not null;
  key bu_group : abap.char(4) not null;
  nrrng        : abap.char(2);
}
