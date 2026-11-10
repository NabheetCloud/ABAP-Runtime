@EndUserText.label : 'Item categories'
define table tvap {
  key mandt : abap.clnt not null;
  key pstyv : abap.char(4) not null;
  fkrel     : abap.char(1);
  prsfd     : abap.char(1);
  vtext     : abap.char(40);
}
