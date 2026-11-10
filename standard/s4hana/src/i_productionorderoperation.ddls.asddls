@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Production Order Operation'
@VDM.viewType: #BASIC
@ObjectModel.usageType.dataClass: #MASTER
define view entity I_ProductionOrderOperation
  as select from afvc
{
  key aufpl as OrderInternalBillOfOperations,
  key aplzl as OrderOperationInternalID,
      vornr as ProductionOrderOperation,
      arbid as WorkCenterInternalID,
      ltxa1 as OperationDescription,
      objnr as MaintObjectInternalID,
      rueck as MfgOrderConfirmationGroup,
      aufnr as OrderID,
      rmzhl as MfgOrderConfirmation,
      werks as Plant
}
where steus = 'PP01'
