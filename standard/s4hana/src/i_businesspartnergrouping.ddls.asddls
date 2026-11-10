@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Business Partner Grouping'
@VDM.viewType: #BASIC
@ObjectModel.usageType.dataClass: #MASTER
define view entity I_BusinessPartnerGrouping
  as select from tb001
  association [0..*] to I_BusinessPartnerGroupingText as _Text on $projection.BusinessPartnerGrouping = _Text.BusinessPartnerGrouping
{
  key bu_group as BusinessPartnerGrouping,
      nrrng as NumberRangeInterval,
    _Text
}
