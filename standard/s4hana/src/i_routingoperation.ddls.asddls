@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Routing Operation'
@VDM.viewType: #BASIC
@ObjectModel.usageType.dataClass: #MASTER
define view entity I_RoutingOperation
  as select from plpo
{
  key plnty as BillOfOperationsType,
  key plnnr as BillOfOperationsGroup,
  key plnkn as BOOOperationInternalID,
  key zaehl as BOOOpInternalVersionCounter,
      vornr as Operation,
      arbid as WorkCenterInternalID,
      steus as OperationControlProfile,
      ltxa1 as OperationText,
      werks as Plant
}
