@EndUserText.label : 'Purchase order item'
@AbapCatalog.enhancement.category : #NOT_EXTENSIBLE
define structure zpo_s_item {
  ebelp : abap.numc(5);
  matnr : abap.char(18);
  txz01 : abap.char(40);
  @Semantics.quantity.unitOfMeasure : 'zpo_s_item.meins'
  menge : zpo_menge;
  meins : abap.unit(3);
  @Semantics.amount.currencyCode : 'zpo_s_item.waers'
  netpr : zpo_netwr;
  waers : abap.cuky;
}
