@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Reservation'
@VDM.viewType: #BASIC
@ObjectModel.usageType.dataClass: #MASTER
define view entity I_Reservation
  as select from rkpf
{
  key rsnum as Reservation,
      bdter as MatlCompRequirementDate,
      kostl as CostCenter,
      aufnr as OrderID,
      bwart as GoodsMovementType,
      usnam as CreatedByUser
}
