@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Production Order Item'
@VDM.viewType: #BASIC
@ObjectModel.usageType.dataClass: #MASTER
define view entity I_ProductionOrderItem
  as select from afpo
{
  key aufnr as ProductionOrder,
  key posnr as ProductionOrderItem,
      matnr as Material,
      psmng as PlannedTotalQuantity,
      wemng as GoodsReceiptQuantity,
      lgort as StorageLocation,
      charg as Batch,
      kdauf as SalesOrder,
      kdpos as SalesOrderItem,
      verid as ProductionVersion,
      elikz as IsCompletelyDelivered,
      meins as BaseUnit
}
