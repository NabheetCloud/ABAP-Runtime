@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Profit Center - Text'
@VDM.viewType: #BASIC
@ObjectModel.dataCategory: #TEXT
@ObjectModel.usageType.dataClass: #MASTER
define view entity I_ProfitCenterText
  as select from cepct
{
  key kokrs as ControllingArea,
  key prctr as ProfitCenter,
  key datbi as ValidityEndDate,
  key spras as Language,
      ktext as ProfitCenterName,
      ltext as ProfitCenterLongName
}
