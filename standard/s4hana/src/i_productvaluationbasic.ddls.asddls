@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Product Valuation'
@VDM.viewType: #BASIC
@ObjectModel.usageType.dataClass: #MASTER
define view entity I_ProductValuationBasic
  as select from mbew
{
  key matnr as Product,
  key bwkey as ValuationArea,
  key bwtar as ValuationType,
      vprsv as InventoryValuationProcedure,
      verpr as MovingAveragePrice,
      stprs as StandardPrice,
      peinh as PriceUnitQty,
      bklas as ValuationClass,
      waers as Currency
}
