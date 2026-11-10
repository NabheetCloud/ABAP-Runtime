@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'MRP Type - Text'
@VDM.viewType: #BASIC
@ObjectModel.dataCategory: #TEXT
@ObjectModel.usageType.dataClass: #MASTER
define view entity I_MRPTypeText
  as select from t438t
{
  key dismm as MRPType,
  key spras as Language,
      dibez as MRPTypeName
}
