@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Product Sales Delivery'
@VDM.viewType: #BASIC
@ObjectModel.usageType.dataClass: #MASTER
define view entity I_ProductSalesDelivery
  as select from mvke
{
  key matnr as Product,
  key vkorg as ProductSalesOrg,
  key vtweg as ProductDistributionChnl,
      dwerk as SupplyingPlant,
      vrkme as SalesMeasureUnit,
      aumng as MinimumOrderQuantity,
      mtpos as ItemCategoryGroup,
      lvorm as IsMarkedForDeletion
}
