@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Currency'
@VDM.viewType: #BASIC
@ObjectModel.usageType.dataClass: #MASTER
define view entity I_Currency
  as select from tcurc
  association [0..*] to I_CurrencyText as _Text on $projection.Currency = _Text.Currency
{
  key waers as Currency,
      isocd as CurrencyISOCode,
      altwr as AlternativeCurrencyKey,
      xprimary as IsPrimaryCurrencyForISOCrcy,
    _Text
}
