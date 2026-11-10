@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Purchasing Organization'
@VDM.viewType: #BASIC
@ObjectModel.usageType.dataClass: #MASTER
define view entity I_PurchasingOrganization
  as select from t024e
{
  key ekorg as PurchasingOrganization,
      ekotx as PurchasingOrganizationName,
      bukrs as CompanyCode
}
