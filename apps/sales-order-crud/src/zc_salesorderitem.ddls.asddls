@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Sales Order Item - Projection'
@Metadata.allowExtensions: true
define view entity ZC_SalesOrderItem
  as projection on ZR_SalesOrderItem
{
  key ItemUUID,
      OrderUUID,
      ItemNo,
      @Consumption.valueHelpDefinition: [{ entity: { name: 'ZI_SOProduct', element: 'ProductID' } }]
      @ObjectModel.text.element: ['ProductName']
      ProductID,
      _Product.ProductName as ProductName,
      Quantity,
      QuantityUnit,
      UnitPrice,
      NetAmount,
      CurrencyCode,
      LocalLastChangedAt,

      _SalesOrder : redirected to parent ZC_SalesOrder,
      _Product
}
