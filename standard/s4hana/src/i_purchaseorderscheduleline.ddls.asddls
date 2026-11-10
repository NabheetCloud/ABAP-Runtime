@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Purchase Order Schedule Line'
@VDM.viewType: #BASIC
@ObjectModel.usageType.dataClass: #MASTER
define view entity I_PurchaseOrderScheduleLine
  as select from eket
{
  key ebeln as PurchaseOrder,
  key ebelp as PurchaseOrderItem,
  key etenr as ScheduleLine,
      eindt as ScheduleLineDeliveryDate,
      menge as ScheduleLineOrderQuantity,
      wemng as GoodsReceiptQuantity,
      banfn as PurchaseRequisition,
      bnfpo as PurchaseRequisitionItem,
      charg as Batch,
      menge - wemng as ScheduleLineOpenQuantity
}
