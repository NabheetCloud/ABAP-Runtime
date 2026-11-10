@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Sales Area'
@VDM.viewType: #BASIC
@ObjectModel.usageType.dataClass: #MASTER
define view entity I_SalesArea
  as select from tvta
{
  key vkorg as SalesOrganization,
  key vtweg as DistributionChannel,
  key spart as Division
}
