@EndUserText.label : 'Storage bins'
define table /scwm/lagp {
  key mandt      : abap.clnt not null;
  key lgnum      : abap.char(4) not null;
  key lgpla      : abap.char(18) not null;
  lgtyp          : abap.char(4);
  lgber          : abap.char(4);
  lptyp          : abap.char(4);
  aisle          : abap.char(4);
  stack          : abap.char(4);
  lvl_v          : abap.char(4);
  kzler          : abap.char(1);
  max_weight     : abap.dec(15,3);
  skzue          : abap.char(1);
}
