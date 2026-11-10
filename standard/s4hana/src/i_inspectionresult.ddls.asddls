@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Inspection Result'
@VDM.viewType: #BASIC
@ObjectModel.usageType.dataClass: #MASTER
define view entity I_InspectionResult
  as select from qamr
{
  key prueflos as InspectionLot,
  key vorglfnr as InspPlanOperationInternalID,
  key merknr as InspectionCharacteristic,
      mittelwert as InspectionResultMeanValue
}
