@EndUserText.label : 'Kanban control cycle'
define table pkhd {
  key mandt : abap.clnt not null;
  key pknum : abap.char(10) not null;
  pkpos     : abap.numc(3);
  matnr     : abap.char(40);
  werks     : abap.char(4);
  prvbe     : abap.char(10);
  pkbst     : abap.char(20);
  behmg     : abap.dec(13,3);
  behaz     : abap.int4;
  pkstu     : abap.char(20);
}
