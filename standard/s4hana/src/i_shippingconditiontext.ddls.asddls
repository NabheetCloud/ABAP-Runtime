@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Shipping Condition - Text'
@VDM.viewType: #BASIC
@ObjectModel.dataCategory: #TEXT
@ObjectModel.usageType.dataClass: #MASTER
define view entity I_ShippingConditionText
  as select from tvsbt
{
  key vsbed as ShippingCondition,
  key spras as Language,
      vtext as ShippingConditionName
}
