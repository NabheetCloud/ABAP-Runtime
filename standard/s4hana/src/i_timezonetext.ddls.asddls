@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Time Zone - Text'
@VDM.viewType: #BASIC
@ObjectModel.dataCategory: #TEXT
@ObjectModel.usageType.dataClass: #MASTER
define view entity I_TimeZoneText
  as select from ttzzt
{
  key tzone as TimeZoneID,
  key langu as Language,
      descript as TimeZoneText
}
