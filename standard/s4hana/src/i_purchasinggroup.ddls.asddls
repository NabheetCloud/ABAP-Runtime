@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Purchasing Group'
@VDM.viewType: #BASIC
@ObjectModel.usageType.dataClass: #MASTER
define view entity I_PurchasingGroup
  as select from t024
{
  key ekgrp as PurchasingGroup,
      eknam as PurchasingGroupName,
      tel_number as PurchasingGroupPhoneNumber,
      smtp_addr as EmailAddress
}
