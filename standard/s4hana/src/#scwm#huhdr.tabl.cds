@EndUserText.label : 'Handling unit header'
define table /scwm/huhdr {
  key mandt      : abap.clnt not null;
  key guid_hu    : abap.char(32) not null;
  lgnum          : abap.char(4);
  huident        : abap.char(20);
  pmat           : abap.char(40);
  lgpla          : abap.char(18);
  hustat         : abap.char(4);
  g_weight       : abap.dec(15,3);
  unit_gw        : abap.unit(3);
  created_at     : abap.dats;
}
