@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Product Valuation'
@VDM.viewType: #BASIC
@ObjectModel.usageType.dataClass: #MASTER
define view entity I_ProductValuation
  as select from mbew
{
  key matnr as Product,
  key bwkey as ValuationArea,
  key bwtar as ValuationType,
      vprsv as InventoryValuationProcedure,
      verpr as MovingAveragePrice,
      stprs as StandardPrice,
      peinh as NetPriceQuantity,
      waers as Currency,
      lbkum as ValuatedStockQuantity,
      salk3 as StockValueInCCCrcy
}
