@EndUserText.label : 'Sales Order'
define table zsalesorder_a {
  key client              : abap.clnt not null;
  key order_uuid          : sysuuid_x16 not null;
  order_id                : abap.numc(10);
  customer_id             : abap.numc(6);
  description             : abap.char(256);
  order_date              : abap.dats;
  delivery_date           : abap.dats;
  @Semantics.amount.currencyCode : 'zsalesorder_a.currency_code'
  gross_amount            : abap.curr(16,2);
  currency_code           : abap.cuky;
  overall_status          : abap.char(1);
  created_by              : abp_creation_user;
  created_at              : abp_creation_tstmpl;
  last_changed_by         : abp_lastchange_user;
  last_changed_at         : abp_lastchange_tstmpl;
  local_last_changed_at   : abp_locinst_lastchange_tstmpl;
}
