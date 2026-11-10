@EndUserText.label : 'Incoterms'
define table tinc {
  key mandt : abap.clnt not null;
  key inco1 : abap.char(3) not null;
  ortob     : abap.char(1);
}
