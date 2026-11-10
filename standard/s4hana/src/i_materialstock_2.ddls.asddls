@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Material Stock'
@VDM.viewType: #BASIC
@ObjectModel.usageType.dataClass: #MASTER
define view entity I_MaterialStock_2
  as select from matdoc
{
  key matnr as Material,
  key werks as Plant,
  key lgort as StorageLocation,
  key charg as Batch,
  key sobkz as InventorySpecialStockType,
  key meins as MaterialBaseUnit,
      sum(stock_qty) as MatlWrhsStkQtyInMatlBaseUnit
}
group by matnr, werks, lgort, charg, sobkz, meins
