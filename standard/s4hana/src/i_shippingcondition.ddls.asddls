@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Shipping Condition'
@VDM.viewType: #BASIC
@ObjectModel.usageType.dataClass: #MASTER
define view entity I_ShippingCondition
  as select from tvsb
  association [0..*] to I_ShippingConditionText as _Text on $projection.ShippingCondition = _Text.ShippingCondition
{
  key vsbed as ShippingCondition,
    _Text
}
