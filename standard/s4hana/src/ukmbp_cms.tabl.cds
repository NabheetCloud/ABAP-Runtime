@EndUserText.label : 'Credit profile (BP)'
define table ukmbp_cms {
  key mandt        : abap.clnt not null;
  key partner      : abap.char(10) not null;
  risk_class       : abap.char(3);
  check_rule       : abap.char(10);
  credit_score     : abap.char(20);
  credit_group     : abap.char(4);
}
