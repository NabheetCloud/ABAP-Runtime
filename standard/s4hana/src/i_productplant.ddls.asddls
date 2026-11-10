@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Product Plant'
@VDM.viewType: #BASIC
@ObjectModel.usageType.dataClass: #MASTER
define view entity I_ProductPlant
  as select from marc
{
  key matnr as Product,
  key werks as Plant,
      ekgrp as PurchasingGroup,
      prctr as ProfitCenter
}
