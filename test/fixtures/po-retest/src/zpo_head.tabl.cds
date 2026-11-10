@EndUserText.label : 'PO header'
@AbapCatalog.enhancement.category : #NOT_EXTENSIBLE
@AbapCatalog.tableCategory : #TRANSPARENT
@AbapCatalog.deliveryClass : #A
@AbapCatalog.dataMaintenance : #RESTRICTED
@AbapCatalog.technicalSettings.dataClass : #APPL1
define table zpo_head {
  key client            : abap.clnt not null;
  key ebeln             : zpo_ebeln not null;
  bukrs                 : abap.char(4);
  lifnr                 : abap.char(10);
  bedat                 : abap.dats;
  @Semantics.amount.currencyCode : 'zpo_head.waers'
  netwr                 : zpo_netwr;
  waers                 : abap.cuky;
  status                : zpo_stat;
  ernam                 : abap.char(12);
}
