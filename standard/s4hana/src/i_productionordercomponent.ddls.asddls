@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Production Order Component'
@VDM.viewType: #BASIC
@ObjectModel.usageType.dataClass: #MASTER
define view entity I_ProductionOrderComponent
  as select from resb
{
  key rsnum as Reservation,
  key rspos as ReservationItem,
  key rsart as RecordType,
      matnr as Material,
      werks as Plant,
      lgort as StorageLocation,
      bdmng as RequiredQuantity,
      enmng as WithdrawnQuantity,
      bdter as MatlCompRequirementDate,
      aufnr as ProductionOrder,
      bwart as GoodsMovementType,
      xloek as ReservationItemIsMarkedForDeltn,
      kzear as ReservationItemIsFinallyIssued,
      meins as BaseUnit,
      posnr as SalesDocumentItem,
      postp as BillOfMaterialItemCategory
}
where aufnr <> ''
