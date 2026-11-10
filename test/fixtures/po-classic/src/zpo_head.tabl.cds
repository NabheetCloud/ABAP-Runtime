@EndUserText.label : 'Purchase order header'
@AbapCatalog.tableCategory : #TRANSPARENT
@AbapCatalog.deliveryClass : #A
define table zpo_head {
  key client            : abap.clnt not null;
  key ebeln             : zpo_ebeln not null;
  lifnr                 : abap.char(10);
  bedat                 : abap.dats;
  status                : zpo_stat;
  @Semantics.amount.currencyCode : 'zpo_head.waers'
  netwr                 : zpo_netwr;
  waers                 : abap.cuky;
  created_by            : abp_creation_user;
  created_at            : abp_creation_tstmpl;
  last_changed_by       : abp_lastchange_user;
  last_changed_at       : abp_lastchange_tstmpl;
  local_last_changed_at : abp_locinst_lastchange_tstmpl;
}
