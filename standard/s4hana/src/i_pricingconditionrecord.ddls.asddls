@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Pricing Condition Record'
@VDM.viewType: #BASIC
@ObjectModel.usageType.dataClass: #MASTER
define view entity I_PricingConditionRecord
  as select from konp
{
  key knumh as ConditionRecord,
  key kopos as ConditionSequentialNumber,
      kschl as ConditionType,
      kbetr as ConditionRateValue,
      konwa as ConditionRateValueUnit,
      kpein as ConditionQuantity,
      kmein as ConditionQuantityUnit,
      loevm_ko as ConditionIsDeleted
}
