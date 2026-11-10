@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Maintenance Order Operation'
@VDM.viewType: #BASIC
@ObjectModel.usageType.dataClass: #MASTER
define view entity I_MaintenanceOrderOperation
  as select from afvc
{
  key aufpl as MaintOrderRoutingNumber,
  key aplzl as MaintOrderOperationCounter,
      vornr as MaintenanceOrderOperation,
      arbid as WorkCenterInternalID,
      ltxa1 as OperationDescription,
      objnr as MaintObjectInternalID,
      rueck as MfgOrderConfirmationGroup,
      aufnr as OrderID,
      rmzhl as MfgOrderConfirmation,
      werks as Plant
}
where steus = 'PM01'
