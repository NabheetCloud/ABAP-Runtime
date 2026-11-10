@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Currency - Text'
@VDM.viewType: #BASIC
@ObjectModel.dataCategory: #TEXT
@ObjectModel.usageType.dataClass: #MASTER
define view entity I_CurrencyText
  as select from tcurt
{
  key waers as Currency,
  key spras as Language,
      ltext as CurrencyName,
      ktext as CurrencyShortName
}
