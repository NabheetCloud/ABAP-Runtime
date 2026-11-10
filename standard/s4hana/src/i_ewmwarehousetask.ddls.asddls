@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'EWM Warehouse Task (confirmed)'
@VDM.viewType: #BASIC
@ObjectModel.usageType.dataClass: #MASTER
define view entity I_EWMWarehouseTask
  as select from /scwm/ordim_c
{
  key lgnum as EWMWarehouse,
  key tanum as WarehouseTask,
  key tapos as WarehouseTaskItem,
      who as WarehouseOrder,
      procty as WarehouseProcessType,
      tostat as WarehouseTaskStatus,
      matnr as Product,
      charg as Batch,
      vsola as ConfirmedQuantity,
      meins as BaseUnit,
      vlpla as SourceStorageBin,
      nlpla as DestinationStorageBin,
      rdocno as EWMDelivery,
      confirmed_at as ConfirmationDate
}
