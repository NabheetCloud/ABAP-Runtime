@EndUserText.label : 'Purchase order with items'
@AbapCatalog.enhancement.category : #NOT_EXTENSIBLE
define structure zpo_s_po {
  include zpo_s_header;
  items : zpo_t_items;
}
