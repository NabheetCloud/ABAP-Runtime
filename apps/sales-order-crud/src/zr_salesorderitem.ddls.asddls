@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Sales Order Item'
define view entity ZR_SalesOrderItem
  as select from zsoitem_a
  association to parent ZR_SalesOrder as _SalesOrder on $projection.OrderUUID = _SalesOrder.OrderUUID
  association [0..1] to ZI_SOProduct  as _Product    on $projection.ProductID = _Product.ProductID
{
  key item_uuid             as ItemUUID,
      parent_uuid           as OrderUUID,
      item_no               as ItemNo,
      product_id            as ProductID,
      @Semantics.quantity.unitOfMeasure: 'QuantityUnit'
      quantity              as Quantity,
      quantity_unit         as QuantityUnit,
      @Semantics.amount.currencyCode: 'CurrencyCode'
      unit_price            as UnitPrice,
      @Semantics.amount.currencyCode: 'CurrencyCode'
      net_amount            as NetAmount,
      currency_code         as CurrencyCode,
      @Semantics.systemDateTime.localInstanceLastChangedAt: true
      local_last_changed_at as LocalLastChangedAt,

      _SalesOrder,
      _Product
}
