@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Incoterms Classification - Text'
@VDM.viewType: #BASIC
@ObjectModel.dataCategory: #TEXT
@ObjectModel.usageType.dataClass: #MASTER
define view entity I_IncotermsClassificationText
  as select from tinct
{
  key inco1 as IncotermsClassification,
  key spras as Language,
      bezei as IncotermsClassificationName
}
