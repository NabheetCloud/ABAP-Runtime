@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Asset line items (compatibility view)'
@VDM.viewType: #BASIC
@ObjectModel.usageType.dataClass: #MASTER
define view entity ANEP
  as select from faat_doc_it
{
  key bukrs as bukrs,
  key anln1 as anln1,
  key anln2 as anln2,
  key gjahr as gjahr,
  key awref as belnr,
  key afabe as afabe,
      anbwa as anbwa,
      anbtr as anbtr,
      budat as bzdat
}
