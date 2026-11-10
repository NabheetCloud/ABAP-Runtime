@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Asset Class'
@VDM.viewType: #BASIC
@ObjectModel.usageType.dataClass: #MASTER
define view entity I_AssetClass
  as select from anka
{
  key anlkl as AssetClass
}
