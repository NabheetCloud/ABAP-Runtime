@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Exchange Rate'
@VDM.viewType: #BASIC
@ObjectModel.usageType.dataClass: #MASTER
define view entity I_ExchangeRateRawData
  as select from tcurr
{
  key kurst as ExchangeRateType,
  key fcurr as SourceCurrency,
  key tcurr as TargetCurrency,
  key gdatu as ValidityStartDate,
      ukurs as ExchangeRate,
      ffact as NumberOfSourceCurrencyUnits,
      tfact as NumberOfTargetCurrencyUnits
}
