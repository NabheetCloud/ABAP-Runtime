@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Storage Location'
@VDM.viewType: #BASIC
@ObjectModel.usageType.dataClass: #MASTER
define view entity I_StorageLocation
  as select from t001l
  association [1..1] to I_Plant as _Plant on $projection.Plant = _Plant.Plant
{
  key werks as Plant,
  key lgort as StorageLocation,
      lgobe as StorageLocationName,
      vkorg as SalesOrganization,
      vtweg as DistributionChannel,
    _Plant
}
