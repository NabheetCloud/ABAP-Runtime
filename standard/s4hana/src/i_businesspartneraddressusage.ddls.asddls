@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Business Partner Address Usage'
@VDM.viewType: #BASIC
@ObjectModel.usageType.dataClass: #MASTER
define view entity I_BusinessPartnerAddressUsage
  as select from but021_fs
{
  key partner as BusinessPartner,
  key adr_kind as AddressUsage,
  key valid_to as ValidityEndDate,
      addrnumber as AddressID,
      valid_from as ValidityStartDate
}
