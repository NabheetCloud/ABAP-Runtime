@EndUserText.label : 'Freight orders, bookings and units'
define table /scmtms/d_torrot {
  key mandt        : abap.clnt not null;
  key db_key       : abap.char(32) not null;
  tor_id           : abap.char(20);
  tor_type         : abap.char(4);
  tor_cat          : abap.char(2);
  lifecycle        : abap.char(2);
  execution        : abap.char(2);
  tspid            : abap.char(10);
  mtr              : abap.char(4);
  purch_org_id     : abap.char(4);
  labeltxt         : abap.char(40);
  created_on       : abap.dats;
  created_by       : abap.char(12);
}
