@EndUserText.label : 'Shipping condition texts'
define table tvsbt {
  key mandt : abap.clnt not null;
  key spras : abap.lang not null;
  key vsbed : abap.char(2) not null;
  vtext     : abap.char(20);
}
