@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Sales Organization'
@VDM.viewType: #BASIC
@ObjectModel.usageType.dataClass: #MASTER
define view entity I_SalesOrganization
  as select from tvko
  association [0..*] to I_SalesOrganizationText as _Text on $projection.SalesOrganization = _Text.SalesOrganization
{
  key vkorg as SalesOrganization,
      waers as SalesOrganizationCurrency,
      bukrs as CompanyCode,
      kunnr as IntercompanyBillingCustomer,
    _Text
}
