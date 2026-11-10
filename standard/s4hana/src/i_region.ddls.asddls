@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Region'
@VDM.viewType: #BASIC
@ObjectModel.usageType.dataClass: #MASTER
define view entity I_Region
  as select from t005s
  association [0..*] to I_RegionText as _Text on $projection.Country = _Text.Country and $projection.Region = _Text.Region
{
  key land1 as Country,
  key bland as Region,
    _Text
}
