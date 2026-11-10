@EndUserText.label : 'Division texts'
define table tspat {
  key mandt : abap.clnt not null;
  key spras : abap.lang not null;
  key spart : abap.char(2) not null;
  vtext     : abap.char(20);
}
