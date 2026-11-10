@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Sales Order Item Pricing Element'
@VDM.viewType: #BASIC
@ObjectModel.usageType.dataClass: #MASTER
define view entity I_SalesOrderItemPricingElement
  as select from prcd_elements
{
  key knumv as PricingDocument,
  key kposn as SalesOrderItem,
  key stunr as PricingProcedureStep,
  key zaehk as PricingProcedureCounter,
      kschl as ConditionType,
      kbetr as ConditionRateValue,
      kpein as ConditionQuantity,
      kmein as ConditionQuantityUnit,
      kwert as ConditionAmount,
      waers as Currency,
      kawrt as ConditionBaseValue,
      kinak as ConditionInactiveReason,
      kstat as ConditionIsForStatistics,
      knumh as ConditionRecord
}
