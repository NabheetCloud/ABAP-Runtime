@EndUserText.label : 'Transportation requirements'
define table /scmtms/d_trqrot {
  key mandt        : abap.clnt not null;
  key db_key       : abap.char(32) not null;
  trq_id           : abap.char(20);
  trq_type         : abap.char(4);
  trq_cat          : abap.char(2);
  base_btd_id      : abap.char(35);
  base_btd_tco     : abap.char(5);
  lifecycle        : abap.char(2);
  created_on       : abap.dats;
}
