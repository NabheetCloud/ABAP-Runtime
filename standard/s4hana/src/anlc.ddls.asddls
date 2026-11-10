@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Asset values per year (compatibility view)'
@VDM.viewType: #BASIC
@ObjectModel.usageType.dataClass: #MASTER
define view entity ANLC
  as select from faat_ydda
{
  key bukrs as bukrs,
  key anln1 as anln1,
  key anln2 as anln2,
  key gjahr as gjahr,
  key afabe as afabe,
      kansw as kansw,
      knafa as knafa,
      nafag as nafag,
      waers as waers
}
