@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Region - Text'
@VDM.viewType: #BASIC
@ObjectModel.dataCategory: #TEXT
@ObjectModel.usageType.dataClass: #MASTER
define view entity I_RegionText
  as select from t005u
{
  key land1 as Country,
  key bland as Region,
  key spras as Language,
      bezei as RegionName
}
