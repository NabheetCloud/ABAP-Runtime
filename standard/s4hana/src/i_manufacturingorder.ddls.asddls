@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Manufacturing Order'
@VDM.viewType: #BASIC
@ObjectModel.usageType.dataClass: #MASTER
define view entity I_ManufacturingOrder
  as select from afko
{
  key aufnr as ManufacturingOrder,
      plnbez as Material,
      gamng as MfgOrderPlannedTotalQty,
      gmein as ProductionUnit,
      gstrp as MfgOrderPlannedStartDate,
      gltrp as MfgOrderPlannedEndDate,
      aufpl as OrderInternalBillOfOperations,
      rsnum as Reservation,
      stlnr as BillOfMaterial,
      stlal as BillOfMaterialVariant
}
