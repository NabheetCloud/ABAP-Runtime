@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Product'
@Search.searchable: true
define view entity ZI_SOProduct
  as select from zsoproduct_a
{
  key product_id    as ProductID,
      @Search.defaultSearchElement: true
      name          as ProductName,
      category      as Category,
      @Semantics.amount.currencyCode: 'CurrencyCode'
      price         as Price,
      currency_code as CurrencyCode,
      base_unit     as BaseUnit
}
