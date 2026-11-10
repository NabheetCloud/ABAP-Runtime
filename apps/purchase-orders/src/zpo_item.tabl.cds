@EndUserText.label : 'PO item'
@AbapCatalog.enhancement.category : #NOT_EXTENSIBLE
@AbapCatalog.tableCategory : #TRANSPARENT
@AbapCatalog.deliveryClass : #A
@AbapCatalog.dataMaintenance : #RESTRICTED
define table zpo_item {
  key client : abap.clnt not null;
  key ebeln  : zpo_ebeln not null
    with foreign key [0..*,1] zpo_head
      where client = zpo_item.client and ebeln = zpo_item.ebeln;
  key ebelp  : abap.numc(5) not null;
  matnr      : abap.char(18);
  @Semantics.quantity.unitOfMeasure : 'zpo_item.meins'
  menge      : zpo_menge;
  meins      : abap.unit;
  @Semantics.amount.currencyCode : 'zpo_item.waers'
  netpr      : zpo_netwr;
  waers      : abap.cuky;
}
