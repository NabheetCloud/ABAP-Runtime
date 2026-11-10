@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Time Zone'
@VDM.viewType: #BASIC
@ObjectModel.usageType.dataClass: #MASTER
define view entity I_TimeZone
  as select from ttzz
  association [0..*] to I_TimeZoneText as _Text on $projection.TimeZoneID = _Text.TimeZoneID
{
  key tzone as TimeZoneID,
      zonerule as TimeZoneRule,
      dstrule as DaylightSavingTimeRule,
      flagactive as TimeZoneIsActive,
    _Text
}
