@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Reservation Document Item'
@VDM.viewType: #BASIC
@ObjectModel.usageType.dataClass: #MASTER
define view entity I_ReservationDocumentItem
  as select from resb
{
  key rsnum as Reservation,
  key rspos as ReservationItem,
  key rsart as RecordType,
      matnr as Material,
      werks as Plant,
      lgort as StorageLocation,
      bdmng as ResvnItmRequiredQtyInBaseUnit,
      enmng as ResvnItmWithdrawnQtyInBaseUnit,
      bdter as MatlCompRequirementDate,
      aufnr as OrderID,
      bwart as GoodsMovementType,
      xloek as ReservationItemIsMarkedForDeltn,
      kzear as ReservationItemIsFinallyIssued,
      meins as BaseUnit,
      posnr as SalesDocumentItem,
      postp as BillOfMaterialItemCategory
}
