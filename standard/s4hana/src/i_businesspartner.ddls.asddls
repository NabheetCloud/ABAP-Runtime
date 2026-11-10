@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Business Partner'
@VDM.viewType: #BASIC
@ObjectModel.usageType.dataClass: #MASTER
define view entity I_BusinessPartner
  as select from but000
  association [0..*] to I_BusinessPartnerRole as _BusinessPartnerRole on $projection.BusinessPartner = _BusinessPartnerRole.BusinessPartner
  association [0..1] to I_Customer as _Customer on $projection.BusinessPartner = _Customer.Customer
  association [0..1] to I_Supplier as _Supplier on $projection.BusinessPartner = _Supplier.Supplier
{
  key partner as BusinessPartner,
      type as BusinessPartnerCategory,
      bu_group as BusinessPartnerGrouping,
      case type when '1' then concat_with_space(name_first, name_last, 1) else name_org1 end as BusinessPartnerFullName,
      case type when '1' then concat_with_space(name_first, name_last, 1) else name_org1 end as BusinessPartnerName,
      name_first as FirstName,
      name_last as LastName,
      name_org1 as OrganizationBPName1,
      name_org2 as OrganizationBPName2,
      bu_sort1 as SearchTerm1,
      xblck as BusinessPartnerIsBlocked,
      xdele as IsMarkedForArchiving,
      crdat as CreationDate,
      crusr as CreatedByUser,
      chdat as LastChangeDate,
    _BusinessPartnerRole,
    _Customer,
    _Supplier
}
