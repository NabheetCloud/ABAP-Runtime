@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Inspection Characteristic'
@VDM.viewType: #BASIC
@ObjectModel.usageType.dataClass: #MASTER
define view entity I_InspectionCharacteristic
  as select from qamv
{
  key prueflos as InspectionLot,
  key vorglfnr as InspPlanOperationInternalID,
  key merknr as InspectionCharacteristic,
      kurztext as InspectionSpecificationText
}
