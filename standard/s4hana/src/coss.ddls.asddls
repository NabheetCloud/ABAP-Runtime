@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Cost totals for internal postings (compatibility view of COEP)'
@VDM.viewType: #BASIC
@ObjectModel.usageType.dataClass: #MASTER
define view entity COSS
  as select from coep
{
  key objnr as objnr,
  key gjahr as gjahr,
  key kstar as kstar,
  key perio as perbl,
  key twaer as twaer,
      sum(wkgbtr) as wkg,
      sum(wtgbtr) as wtg
}
where vrgng = 'RKU1'
group by objnr, gjahr, kstar, perio, twaer
