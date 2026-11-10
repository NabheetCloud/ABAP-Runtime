@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Manufacturing Order Item'
@VDM.viewType: #BASIC
@ObjectModel.usageType.dataClass: #MASTER
define view entity I_ManufacturingOrderItem
  as select from afpo
{
  key aufnr as ManufacturingOrder,
  key posnr as ManufacturingOrderItem,
      matnr as Material,
      psmng as MfgOrderItemPlannedTotalQty,
      wemng as MfgOrderItemGoodsReceiptQty,
      lgort as StorageLocation,
      charg as Batch,
      kdauf as SalesOrder,
      kdpos as SalesOrderItem,
      verid as ProductionVersion,
      elikz as IsCompletelyDelivered,
      meins as BaseUnit,
      pwerk as ProductionPlant
}
