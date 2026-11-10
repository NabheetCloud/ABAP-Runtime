@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Incoterms Classification'
@VDM.viewType: #BASIC
@ObjectModel.usageType.dataClass: #MASTER
define view entity I_IncotermsClassification
  as select from tinc
  association [0..*] to I_IncotermsClassificationText as _Text on $projection.IncotermsClassification = _Text.IncotermsClassification
{
  key inco1 as IncotermsClassification,
      ortob as LocationIsMandatory,
    _Text
}
