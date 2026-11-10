@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Sales Order Item - Projection'
@Metadata.allowExtensions: true
define view entity ZC_OrderItem
  as projection on ZR_OrderItem
{
  key OrderID,
  key ItemNo,
      Product,
      Quantity,
      UnitPrice,
      Currency,
      Amount,
      _Order : redirected to parent ZC_Order
}
