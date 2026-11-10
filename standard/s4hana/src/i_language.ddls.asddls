@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Language'
@VDM.viewType: #BASIC
@ObjectModel.usageType.dataClass: #MASTER
define view entity I_Language
  as select from t002
  association [0..*] to I_LanguageText as _Text on $projection.Language = _Text.Language
{
  key spras as Language,
      laiso as LanguageISOCode,
    _Text
}
