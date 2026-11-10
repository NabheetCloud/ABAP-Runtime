@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Purchase order item (form data provider)'
define view entity ZI_PurchaseOrderDocItem
  as select from zpodoc_item_a
  association [0..1] to I_Product            as _Product   on  $projection.Product = _Product.Product
  association [0..1] to I_ProductText        as _Text      on  $projection.Product = _Text.Product
                                                           and _Text.Language      = 'E'
  association [0..1] to I_ProductGroupText_2 as _GroupText on  $projection.MaterialGroup = _GroupText.ProductGroup
                                                           and _GroupText.Language        = 'E'
  association [0..1] to ZI_PurchaseOrderGRConfItem as _GRItem on  $projection.PONumber = _GRItem.PONumber
                                                              and $projection.ItemNo   = _GRItem.ItemNo
{
  key po_number              as PONumber,
  key item_no                as ItemNo,
      product                as Product,
      _Text.ProductName      as Description,
      _Product.ProductGroup  as MaterialGroup,
      _GroupText.ProductGroupText as MaterialGroupText,
      quantity               as Quantity,
      unit                   as Unit,
      unit_price             as UnitPrice,
      _GRItem.ReceivedQuantity as ReceivedQuantity
}
