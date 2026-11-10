@EndUserText.label : 'Purchase order item'
@AbapCatalog.enhancement.category : #NOT_EXTENSIBLE
@AbapCatalog.tableCategory : #TRANSPARENT
@AbapCatalog.deliveryClass : #A
@AbapCatalog.dataMaintenance : #RESTRICTED
define table zpo_item {
  key client : abap.clnt not null;
  @AbapCatalog.foreignKey.screenCheck : false
  key ebeln  : zpo_ebeln not null
    with foreign key zpo_head
      where client = zpo_item.client
        and ebeln = zpo_item.ebeln;
  key ebelp  : abap.numc(5) not null;
  matnr      : abap.char(18);
  txz01      : abap.char(40);
  @Semantics.quantity.unitOfMeasure : 'zpo_item.meins'
  menge      : zpo_menge;
  meins      : abap.unit(3);
  @Semantics.amount.currencyCode : 'zpo_item.waers'
  netpr      : zpo_netwr;
  waers      : abap.cuky;
}
