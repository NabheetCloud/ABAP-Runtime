@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Goods receipt confirmation: received quantity per item'
define view entity ZI_PurchaseOrderGRConfItem
  as select from zpodoc_gritem_a
{
  key po_number    as PONumber,
  key item_no      as ItemNo,
      received_qty as ReceivedQuantity
}
