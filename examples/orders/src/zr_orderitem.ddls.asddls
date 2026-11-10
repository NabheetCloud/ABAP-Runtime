@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Sales Order Item'
define view entity ZR_OrderItem
  as select from zorder_i
  association to parent ZR_Order as _Order on $projection.OrderID = _Order.OrderID
{
  key order_id   as OrderID,
  key item_no    as ItemNo,
      product    as Product,
      quantity   as Quantity,
      @Semantics.amount.currencyCode: 'Currency'
      unit_price as UnitPrice,
      currency   as Currency,
      @Semantics.amount.currencyCode: 'Currency'
      amount     as Amount,
      _Order
}
