@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Manufacturing Order Confirmation'
@VDM.viewType: #BASIC
@ObjectModel.usageType.dataClass: #MASTER
define view entity I_MfgOrderConfirmation
  as select from afru
{
  key rueck as MfgOrderConfirmationGroup,
  key rmzhl as MfgOrderConfirmation,
      aufnr as ManufacturingOrder,
      vornr as ManufacturingOrderOperation,
      arbid as WorkCenterInternalID,
      budat as PostingDate,
      lmnga as ConfirmationYieldQuantity,
      xmnga as ConfirmationScrapQuantity,
      ernam as CreatedByUser,
      gmein as ProductionUnit,
      ism01 as OpWorkQuantity1,
      ltxa1 as MfgOrderOperationText,
      werks as Plant
}
