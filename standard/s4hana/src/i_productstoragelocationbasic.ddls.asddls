@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Product Storage Location'
@VDM.viewType: #BASIC
@ObjectModel.usageType.dataClass: #MASTER
define view entity I_ProductStorageLocationBasic
  as select from mard
{
  key matnr as Product,
  key werks as Plant,
  key lgort as StorageLocation,
      lgpbe as WarehouseStorageBin,
      lvorm as IsMarkedForDeletion
}
