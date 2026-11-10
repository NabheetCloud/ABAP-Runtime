@EndUserText.label : 'Sales Order Item'
define table zsoitem_a {
  key client            : abap.clnt not null;
  key item_uuid         : sysuuid_x16 not null;
  parent_uuid           : sysuuid_x16;
  item_no               : abap.numc(6);
  product_id            : abap.char(10);
  @Semantics.quantity.unitOfMeasure : 'zsoitem_a.quantity_unit'
  quantity              : abap.quan(13,3);
  quantity_unit         : abap.unit(3);
  @Semantics.amount.currencyCode : 'zsoitem_a.currency_code'
  unit_price            : abap.curr(16,2);
  @Semantics.amount.currencyCode : 'zsoitem_a.currency_code'
  net_amount            : abap.curr(16,2);
  currency_code         : abap.cuky;
  local_last_changed_at : abp_locinst_lastchange_tstmpl;
}
