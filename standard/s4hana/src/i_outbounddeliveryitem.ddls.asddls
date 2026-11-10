@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Outbound Delivery Item'
@VDM.viewType: #BASIC
@ObjectModel.usageType.dataClass: #MASTER
define view entity I_OutboundDeliveryItem
  as select from lips
{
  key vbeln as OutboundDelivery,
  key posnr as OutboundDeliveryItem,
      matnr as Material,
      werks as Plant,
      lgort as StorageLocation,
      charg as Batch,
      lfimg as ActualDeliveryQuantity,
      vrkme as DeliveryQuantityUnit,
      lgmng as ActualDeliveredQtyInBaseUnit,
      meins as BaseUnit,
      vgbel as ReferenceSDDocument,
      vgpos as ReferenceSDDocumentItem,
      pstyv as SalesDocumentItemCategory,
      wbsta as GoodsMovementStatus,
      arktx as DeliveryDocumentItemText,
      vkbur as SalesOffice,
      erdat as CreationDate,
      matkl as MaterialGroup,
      prctr as ProfitCenter
}
