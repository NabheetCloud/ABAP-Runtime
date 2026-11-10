@EndUserText.label : 'Quants (stock in bins)'
define table /scwm/quan {
  key mandt      : abap.clnt not null;
  key lgnum      : abap.char(4) not null;
  key guid_stock : abap.char(32) not null;
  lgpla          : abap.char(18);
  matnr          : abap.char(40);
  charg          : abap.char(10);
  cat            : abap.char(2);
  quan           : abap.dec(13,3);
  unit           : abap.unit(3);
  owner          : abap.char(10);
  entitled       : abap.char(10);
  huident        : abap.char(20);
  wdatu          : abap.dats;
}
