@EndUserText.label : 'Open warehouse tasks'
define table /scwm/ordim_o {
  key mandt      : abap.clnt not null;
  key lgnum      : abap.char(4) not null;
  key tanum      : abap.numc(12) not null;
  key tapos      : abap.numc(4) not null;
  who            : abap.char(10);
  procty         : abap.char(4);
  tostat         : abap.char(1);
  matnr          : abap.char(40);
  charg          : abap.char(10);
  vsolm          : abap.dec(13,3);
  meins          : abap.unit(3);
  vlpla          : abap.char(18);
  nlpla          : abap.char(18);
  vlenr          : abap.char(20);
  rdoccat        : abap.char(3);
  rdocno         : abap.char(35);
  created_at     : abap.dats;
}
