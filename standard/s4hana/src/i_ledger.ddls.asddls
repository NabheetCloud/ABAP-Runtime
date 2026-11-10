@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Ledger'
@VDM.viewType: #BASIC
@ObjectModel.usageType.dataClass: #MASTER
define view entity I_Ledger
  as select from finsc_ledger
{
  key rldnr as Ledger,
      name as SegmentName
}
