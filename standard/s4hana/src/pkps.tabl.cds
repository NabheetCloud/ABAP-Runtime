@EndUserText.label : 'Kanban containers'
define table pkps {
  key mandt : abap.clnt not null;
  key pknum : abap.char(10) not null;
  key pkpos : abap.numc(3) not null;
  matnr     : abap.char(40);
  werks     : abap.char(4);
  prvbe     : abap.char(10);
  pkbst     : abap.char(20);
  pkbht     : abap.char(20);
  pkimg     : abap.dec(13,3);
  saedt     : abap.dats;
}
