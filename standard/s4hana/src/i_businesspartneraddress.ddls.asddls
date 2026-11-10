@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Business Partner Address'
@VDM.viewType: #BASIC
@ObjectModel.usageType.dataClass: #MASTER
define view entity I_BusinessPartnerAddress
  as select from but020
{
  key partner as BusinessPartner,
  key addrnumber as AddressID
}
