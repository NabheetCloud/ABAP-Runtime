@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Profit center line items (compatibility view of ACDOCA)'
@VDM.viewType: #BASIC
@ObjectModel.usageType.dataClass: #MASTER
define view entity GLPCA
  as select from acdoca
{
  key rldnr as rldnr,
  key gjahr as ryear,
  key belnr as docnr,
  key docln as docln,
      rbukrs as rbukrs,
      prctr as rprctr,
      racct as racct,
      poper as poper,
      budat as budat,
      hsl as hsl,
      rhcur as rhcur,
      tsl as tsl,
      rtcur as rtcur,
      rcntr as kostl,
      matnr as matnr,
      werks as werks
}
where rldnr = '0L' and prctr <> ''
