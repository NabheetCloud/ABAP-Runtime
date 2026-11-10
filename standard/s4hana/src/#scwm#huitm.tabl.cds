@EndUserText.label : 'Handling unit items'
define table /scwm/huitm {
  key mandt       : abap.clnt not null;
  key guid_parent : abap.char(32) not null;
  key guid_stock  : abap.char(32) not null;
  matnr           : abap.char(40);
  charg           : abap.char(10);
  quan            : abap.dec(13,3);
  unit            : abap.unit(3);
  cat             : abap.char(2);
}
