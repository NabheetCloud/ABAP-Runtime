@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Manufacturing Order Operation'
@VDM.viewType: #BASIC
@ObjectModel.usageType.dataClass: #MASTER
define view entity I_ManufacturingOrderOperation
  as select from afvc
{
  key aufpl as OrderInternalBillOfOperations,
  key aplzl as OrderOperationInternalID,
      vornr as ManufacturingOrderOperation,
      arbid as WorkCenterInternalID,
      ltxa1 as MfgOrderOperationText,
      objnr as MaintObjectInternalID,
      rueck as MfgOrderConfirmationGroup,
      aufnr as OrderID,
      rmzhl as MfgOrderConfirmation,
      werks as Plant
}
