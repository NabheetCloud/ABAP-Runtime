@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Asset document headers (compatibility view)'
@VDM.viewType: #BASIC
@ObjectModel.usageType.dataClass: #MASTER
define view entity ANEK
  as select from faat_doc_it
{
  key bukrs as bukrs,
  key anln1 as anln1,
  key anln2 as anln2,
  key gjahr as gjahr,
  key awref as belnr,
      budat as budat,
      anbwa as anbwa
}
where afabe = '01'
