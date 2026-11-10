@EndUserText.label : 'Inbound deliveries (EWM)'
define table /scwm/prdi {
  key mandt        : abap.clnt not null;
  key docid        : abap.char(32) not null;
  lgnum            : abap.char(4);
  docno            : abap.char(35);
  doctype          : abap.char(4);
  refdocno_erp     : abap.char(10);
  partyno_sf       : abap.char(10);
  status_gr        : abap.char(1);
  created_at       : abap.dats;
}
