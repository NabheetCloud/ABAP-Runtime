@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Sales Organization - Text'
@VDM.viewType: #BASIC
@ObjectModel.dataCategory: #TEXT
@ObjectModel.usageType.dataClass: #MASTER
define view entity I_SalesOrganizationText
  as select from tvkot
{
  key vkorg as SalesOrganization,
  key spras as Language,
      vtext as SalesOrganizationName
}
