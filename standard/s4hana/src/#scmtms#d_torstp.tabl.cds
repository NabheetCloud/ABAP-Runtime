@EndUserText.label : 'Freight order stops'
define table /scmtms/d_torstp {
  key mandt           : abap.clnt not null;
  key db_key          : abap.char(32) not null;
  parent_key          : abap.char(32);
  stop_id             : abap.char(10);
  stop_cat            : abap.char(1);
  log_locid           : abap.char(20);
  plan_trans_time     : abap.dats;
  acc_start           : abap.dats;
}
