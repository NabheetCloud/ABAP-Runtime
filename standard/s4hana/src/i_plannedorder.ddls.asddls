@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Planned Order'
@VDM.viewType: #BASIC
@ObjectModel.usageType.dataClass: #MASTER
define view entity I_PlannedOrder
  as select from plaf
{
  key plnum as PlannedOrder,
      matnr as Material,
      plwrk as MRPPlant,
      gsmng as TotalQuantity,
      psttr as PlannedOrderStartDate,
      pedtr as PlannedOrderEndDate,
      paart as PlannedOrderType,
      verid as ProductionVersion,
      meins as BaseUnit
}
