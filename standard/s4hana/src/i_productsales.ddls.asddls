@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Product Sales'
@VDM.viewType: #BASIC
@ObjectModel.usageType.dataClass: #MASTER
define view entity I_ProductSales
  as select from mvke
{
  key matnr as Product,
  key vkorg as ProductSalesOrg,
  key vtweg as ProductDistributionChnl,
      vrkme as OrderQuantityUnit
}
