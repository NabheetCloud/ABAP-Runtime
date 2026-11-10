@EndUserText.label : 'Purchase order header'
@AbapCatalog.enhancement.category : #NOT_EXTENSIBLE
define structure zpo_s_header {
  ebeln  : zpo_ebeln;
  lifnr  : abap.char(10);
  bedat  : abap.dats;
  status : zpo_stat;
  @Semantics.amount.currencyCode : 'zpo_s_header.waers'
  netwr  : zpo_netwr;
  waers  : abap.cuky;
}
