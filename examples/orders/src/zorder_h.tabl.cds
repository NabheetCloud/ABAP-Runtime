@EndUserText.label : 'Sales order header'
define table zorder_h {
  key client            : abap.clnt not null;
  key order_id          : abap.numc(10) not null;
  customer              : abap.char(60);
  order_date            : abap.dats;
  currency              : abap.cuky;
  total                 : abap.curr(16,2);
  status                : abap.char(1);
  created_by            : abp_creation_user;
  created_at            : abp_creation_tstmpl;
  last_changed_by       : abp_lastchange_user;
  last_changed_at       : abp_lastchange_tstmpl;
  local_last_changed_at : abp_locinst_lastchange_tstmpl;
}
