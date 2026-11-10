@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'MRP Type'
@VDM.viewType: #BASIC
@ObjectModel.usageType.dataClass: #MASTER
define view entity I_MRPType
  as select from t438a
  association [0..*] to I_MRPTypeText as _Text on $projection.MRPType = _Text.MRPType
{
  key dismm as MRPType,
      disvf as MRPProcedure,
    _Text
}
