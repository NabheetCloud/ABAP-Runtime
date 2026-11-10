@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Cost totals for external postings (compatibility view of ACDOCA)'
@VDM.viewType: #BASIC
@ObjectModel.usageType.dataClass: #MASTER
define view entity COSP
  as select from acdoca
{
  key concat('KSA000', rcntr) as objnr,
  key gjahr as gjahr,
  key racct as kstar,
  key poper as perbl,
  key rhcur as twaer,
      sum(hsl) as wkg,
      sum(tsl) as wtg
}
where rldnr = '0L' and rcntr <> ''
group by rcntr, gjahr, racct, poper, rhcur
