@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Country - Text'
@VDM.viewType: #BASIC
@ObjectModel.dataCategory: #TEXT
@ObjectModel.usageType.dataClass: #MASTER
define view entity I_CountryText
  as select from t005t
{
  key land1 as Country,
  key spras as Language,
      landx50 as CountryName,
      landx as CountryShortName,
      natio as NationalityName
}
