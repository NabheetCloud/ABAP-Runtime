@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Production Order'
@VDM.viewType: #BASIC
@ObjectModel.usageType.dataClass: #MASTER
define view entity I_ProductionOrder
  as select from afko
{
  key aufnr as ProductionOrder,
      plnbez as Material,
      gamng as TotalQuantity,
      gmein as ProductionUnit,
      gstrp as OrderPlannedStartDate,
      gltrp as OrderPlannedEndDate,
      aufpl as OrderInternalBillOfOperations,
      rsnum as Reservation,
      stlnr as BillOfMaterial,
      stlal as BillOfMaterialVariant
}
