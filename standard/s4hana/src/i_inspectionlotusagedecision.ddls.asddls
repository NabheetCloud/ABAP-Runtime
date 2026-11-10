@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Inspection Lot Usage Decision'
@VDM.viewType: #BASIC
@ObjectModel.usageType.dataClass: #MASTER
define view entity I_InspectionLotUsageDecision
  as select from qave
{
  key prueflos as InspectionLot,
  key kzart as InspLotUsageDecisionCategory,
  key zaehler as InspLotUsageDecisionCounter,
      vcode as InspLotUsageDecisionCode,
      vdatum as InspLotUsageDecisionDate
}
