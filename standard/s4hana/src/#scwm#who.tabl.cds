@EndUserText.label : 'Warehouse orders'
define table /scwm/who {
  key mandt      : abap.clnt not null;
  key lgnum      : abap.char(4) not null;
  key who        : abap.char(10) not null;
  queue          : abap.char(10);
  areawho        : abap.char(4);
  rsrc           : abap.char(18);
  status         : abap.char(1);
  wcr            : abap.char(4);
  created_at     : abap.dats;
  lsd            : abap.dats;
}
