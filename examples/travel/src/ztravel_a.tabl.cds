@EndUserText.label : 'Travel'
define table ztravel_a {
  key client            : abap.clnt not null;
  key travel_uuid       : sysuuid_x16 not null;
  travel_id             : abap.numc(8);
  customer_id           : abap.numc(6);
  description           : abap.char(256);
  begin_date            : abap.dats;
  end_date              : abap.dats;
  @Semantics.amount.currencyCode : 'ztravel_a.currency_code'
  booking_fee           : abap.curr(16,2);
  @Semantics.amount.currencyCode : 'ztravel_a.currency_code'
  total_price           : abap.curr(16,2);
  currency_code         : abap.cuky;
  overall_status        : abap.char(1);
  reject_reason         : abap.char(80);
  created_by            : abp_creation_user;
  created_at            : abp_creation_tstmpl;
  last_changed_by       : abp_lastchange_user;
  last_changed_at       : abp_lastchange_tstmpl;
  local_last_changed_at : abp_locinst_lastchange_tstmpl;
}
