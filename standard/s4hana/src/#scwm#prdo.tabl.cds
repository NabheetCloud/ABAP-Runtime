@EndUserText.label : 'Outbound delivery orders (EWM)'
define table /scwm/prdo {
  key mandt        : abap.clnt not null;
  key docid        : abap.char(32) not null;
  lgnum            : abap.char(4);
  docno            : abap.char(35);
  doctype          : abap.char(4);
  refdocno_erp     : abap.char(10);
  partyno_st       : abap.char(10);
  status_gi        : abap.char(1);
  status_pick      : abap.char(1);
  created_at       : abap.dats;
}
