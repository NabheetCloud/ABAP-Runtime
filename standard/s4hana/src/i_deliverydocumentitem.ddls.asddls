@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Delivery Document Item'
@VDM.viewType: #BASIC
@ObjectModel.usageType.dataClass: #MASTER
define view entity I_DeliveryDocumentItem
  as select from lips
{
  key vbeln as DeliveryDocument,
  key posnr as DeliveryDocumentItem,
      matnr as Material,
      werks as Plant,
      lgort as StorageLocation,
      charg as Batch,
      lfimg as ActualDeliveryQuantity,
      vrkme as OrderQuantityUnit,
      lgmng as ActualDeliveredQtyInBaseUnit,
      meins as BaseUnit,
      vgbel as ReferenceSDDocument,
      vgpos as ReferenceSDDocumentItem,
      pstyv as DeliveryDocumentItemCategory,
      wbsta as GoodsMovementStatus,
      arktx as DeliveryDocumentItemText,
      vkbur as SalesOffice,
      erdat as CreationDate,
      matkl as MaterialGroup,
      prctr as ProfitCenter
}
