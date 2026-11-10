@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Exchange Rate Type - Text'
@VDM.viewType: #BASIC
@ObjectModel.dataCategory: #TEXT
@ObjectModel.usageType.dataClass: #MASTER
define view entity I_ExchangeRateTypeText
  as select from tcurw
{
  key kurst as ExchangeRateType,
  key spras as Language,
      curvw as ExchangeRateTypeName
}
