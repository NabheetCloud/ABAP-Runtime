@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Purchasing Info Record Org Plant Data (API)'
@VDM.viewType: #BASIC
@ObjectModel.usageType.dataClass: #MASTER
define view entity I_PurgInfoRecdOrgPlantDataApi01
  as select from eine
{
  key infnr as PurchasingInfoRecord,
  key esokz as PurchasingInfoRecordCategory,
  key ekorg as PurchasingOrganization,
  key werks as Plant,
      netpr as NetPriceAmount,
      peinh as NetPriceQuantity,
      aplfz as MaterialPlannedDeliveryDurn,
      norbm as StandardPurchaseOrderQuantity,
      minbm as MinimumPurchaseOrderQuantity,
      waers as Currency,
      ekgrp as PurchasingGroup,
      mwskz as TaxCode
}
