@EndUserText.label : 'Freight charges'
define table /scmtms/d_tccrot {
  key mandt        : abap.clnt not null;
  key db_key       : abap.char(32) not null;
  host_key         : abap.char(32);
  net_amount       : abap.dec(15,2);
  doc_currency     : abap.cuky;
  calc_status      : abap.char(2);
  calc_date        : abap.dats;
}
