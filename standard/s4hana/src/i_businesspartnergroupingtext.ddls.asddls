@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Business Partner Grouping - Text'
@VDM.viewType: #BASIC
@ObjectModel.dataCategory: #TEXT
@ObjectModel.usageType.dataClass: #MASTER
define view entity I_BusinessPartnerGroupingText
  as select from tb002
{
  key bu_group as BusinessPartnerGrouping,
  key spras as Language,
      txt40 as BusinessPartnerGroupingText
}
