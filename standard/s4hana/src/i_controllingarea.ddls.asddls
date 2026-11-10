@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Controlling Area'
@VDM.viewType: #BASIC
@ObjectModel.usageType.dataClass: #MASTER
define view entity I_ControllingArea
  as select from tka01
{
  key kokrs as ControllingArea,
      bezei as ControllingAreaName,
      waers as ControllingAreaCurrency,
      ktopl as ChartOfAccounts,
      lmona as NumberOfPostingPeriods
}
