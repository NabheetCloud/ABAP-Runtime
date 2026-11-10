@EndUserText.label : 'PO header'
@AbapCatalog.enhancement.category : #NOT_EXTENSIBLE
define structure zpo_s_header {
  ebeln                 : zpo_ebeln;
  bukrs                 : abap.char(4);
  lifnr                 : abap.char(10);
  bedat                 : abap.dats;
  @Semantics.amount.currencyCode : 'zpo_s_header.waers'
  netwr                 : zpo_netwr;
  waers                 : abap.cuky;
  status                : zpo_stat;
}
