@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Outbound Delivery'
@VDM.viewType: #BASIC
@ObjectModel.usageType.dataClass: #MASTER
define view entity I_OutboundDelivery
  as select from likp
{
  key vbeln as OutboundDelivery,
      lfart as DeliveryDocumentType,
      vstel as ShippingPoint,
      vkorg as SalesOrganization,
      kunnr as ShipToParty,
      kunag as SoldToParty,
      wadat as PlannedGoodsMovementDate,
      wadat_ist as ActualGoodsMovementDate,
      lfdat as DeliveryDate,
      route as Route,
      btgew as HeaderGrossWeight,
      ntgew as NetWeight,
      gbstk as OverallSDProcessStatus,
      wbstk as OverallGoodsMovementStatus,
      kostk as OverallPickingStatus,
      fkstk as OverallBillingStatus,
      erdat as CreationDate,
      ernam as CreatedByUser,
      vtweg as DistributionChannel,
      lifsk as DeliveryBlockReason,
      gewei as WeightUnit,
      erzet as CreationTime,
      inco1 as IncotermsClassification,
      lddat as LoadingDate,
      vsbed as ShippingCondition
}
