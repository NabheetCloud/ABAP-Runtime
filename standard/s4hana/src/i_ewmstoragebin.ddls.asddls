@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'EWM Storage Bin'
@VDM.viewType: #BASIC
@ObjectModel.usageType.dataClass: #MASTER
define view entity I_EWMStorageBin
  as select from /scwm/lagp
{
  key lgnum as EWMWarehouse,
  key lgpla as EWMStorageBin,
      lgtyp as EWMStorageType,
      lgber as EWMStorageSection,
      lptyp as EWMStorageBinType,
      kzler as EWMStorageBinIsEmpty
}
