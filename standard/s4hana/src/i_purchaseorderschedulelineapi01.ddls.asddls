@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Purchase Order Schedule Line (API)'
@VDM.viewType: #BASIC
@ObjectModel.usageType.dataClass: #MASTER
define view entity I_PurchaseOrderScheduleLineAPI01
  as select from eket
{
  key ebeln as PurchaseOrder,
  key ebelp as PurchaseOrderItem,
  key etenr as ScheduleLine,
      eindt as ScheduleLineDeliveryDate,
      menge as ScheduleLineOrderQuantity,
      wemng as RoughGoodsReceiptQty,
      banfn as PurchaseRequisition,
      bnfpo as PurchaseRequisitionItem,
      charg as Batch
}
