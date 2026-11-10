@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Country'
@VDM.viewType: #BASIC
@ObjectModel.usageType.dataClass: #MASTER
define view entity I_Country
  as select from t005
  association [0..*] to I_CountryText as _Text on $projection.Country = _Text.Country
{
  key land1 as Country,
      intca as CountryISOCode,
      intca3 as CountryThreeLetterISOCode,
      intcn3 as CountryThreeDigitISOCode,
      waers as CountryCurrency,
      xegld as IsEuropeanUnionMember,
    _Text
}
