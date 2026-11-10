@EndUserText.label : 'Shipping point'
define table tvst {
  key mandt : abap.clnt not null;
  key vstel : abap.char(4) not null;
  adrnr     : abap.char(10);
  fabkl     : abap.char(20);
  vtext     : abap.char(40);
  werks     : abap.char(4);
}
