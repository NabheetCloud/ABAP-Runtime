@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Business Partner Role'
@VDM.viewType: #BASIC
@ObjectModel.usageType.dataClass: #MASTER
define view entity I_BusinessPartnerRole
  as select from but100
{
  key partner as BusinessPartner,
  key rltyp as BusinessPartnerRole,
      valid_from as ValidityStartDate,
      valid_to as ValidityEndDate
}
