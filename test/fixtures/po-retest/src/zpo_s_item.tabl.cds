@EndUserText.label : 'PO item'
@AbapCatalog.enhancement.category : #NOT_EXTENSIBLE
define structure zpo_s_item {
  ebeln                 : zpo_ebeln;
  ebelp                 : abap.numc(5);
  matnr                 : abap.char(18);
  @Semantics.quantity.unitOfMeasure : 'zpo_s_item.meins'
  menge                 : zpo_menge;
  meins                 : abap.unit;
  @Semantics.amount.currencyCode : 'zpo_s_item.waers'
  netpr                 : zpo_netwr;
  waers                 : abap.cuky;
}
