@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Sales Order Schedule Line'
@VDM.viewType: #BASIC
@ObjectModel.usageType.dataClass: #MASTER
define view entity I_SalesOrderScheduleLine
  as select from vbep
{
  key vbeln as SalesOrder,
  key posnr as SalesOrderItem,
  key etenr as ScheduleLine,
      edatu as RequestedDeliveryDate,
      wmeng as ScheduleLineOrderQuantity,
      bmeng as ConfdOrderQtyByMatlAvailCheck,
      lmeng as RequiredQuantity,
      ettyp as ScheduleLineCategory,
      mbdat as ProductAvailabilityDate,
      lddat as LoadingDate,
      wadat as GoodsIssueDate,
      meins as BaseUnit,
      vrkme as OrderQuantityUnit
}
