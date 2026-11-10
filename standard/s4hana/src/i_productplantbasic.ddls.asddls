@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Product Plant'
@VDM.viewType: #BASIC
@ObjectModel.usageType.dataClass: #MASTER
define view entity I_ProductPlantBasic
  as select from marc
  association [1..1] to I_Plant as _Plant on $projection.Plant = _Plant.Plant
{
  key matnr as Product,
  key werks as Plant,
      ekgrp as PurchasingGroup,
      dismm as MRPType,
      dispo as MRPResponsible,
      beskz as ProcurementType,
      plifz as PlannedDeliveryDurationInDays,
      minbe as ReorderThresholdQuantity,
      eisbe as SafetyStockQuantity,
      prctr as ProfitCenter,
      mmsta as ProfileCode,
      lvorm as IsMarkedForDeletion,
    _Plant
}
