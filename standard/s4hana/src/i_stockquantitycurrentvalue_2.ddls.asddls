@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Stock Quantity and Value'
@VDM.viewType: #BASIC
@ObjectModel.usageType.dataClass: #MASTER
define view entity I_StockQuantityCurrentValue_2
  as select from matdoc_extract
{
  key matnr as Product,
  key werks as Plant,
  key lgort as StorageLocation,
  key charg as Batch,
  key meins as MaterialBaseUnit,
  key waers as Currency,
      sum(stock_qty) as MatlWrhsStkQtyInMatlBaseUnit,
      sum(value_lc) as StockValueInCCCrcy
}
group by matnr, werks, lgort, charg, meins, waers
