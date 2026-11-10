@EndUserText.label : 'Forecast values'
define table prop {
  key mandt : abap.clnt not null;
  key pnum1 : abap.char(10) not null;
  key hsnum : abap.char(2) not null;
  key versp : abap.char(2) not null;
  key perio : abap.char(6) not null;
  matnr     : abap.char(40);
  werks     : abap.char(4);
  prwrt     : abap.dec(15,2);
}
