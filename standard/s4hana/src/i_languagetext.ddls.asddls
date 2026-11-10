@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Language - Text'
@VDM.viewType: #BASIC
@ObjectModel.dataCategory: #TEXT
@ObjectModel.usageType.dataClass: #MASTER
define view entity I_LanguageText
  as select from t002t
{
  key sprsl as Language,
  key spras as LanguageCode,
      sptxt as LanguageName
}
