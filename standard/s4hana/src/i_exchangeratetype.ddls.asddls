@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Exchange Rate Type'
@VDM.viewType: #BASIC
@ObjectModel.usageType.dataClass: #MASTER
define view entity I_ExchangeRateType
  as select from tcurv
  association [0..*] to I_ExchangeRateTypeText as _Text on $projection.ExchangeRateType = _Text.ExchangeRateType
{
  key kurst as ExchangeRateType,
      xinvr as ExchRateIsInvertedQuotation,
    _Text
}
