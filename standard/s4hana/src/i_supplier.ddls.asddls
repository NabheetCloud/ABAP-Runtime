@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Supplier'
@VDM.viewType: #BASIC
@ObjectModel.usageType.dataClass: #MASTER
define view entity I_Supplier
  as select from lfa1
  association [0..*] to I_SupplierCompany as _SupplierCompany on $projection.Supplier = _SupplierCompany.Supplier
  association [0..*] to I_SupplierPurchasingOrg as _SupplierPurchasingOrg on $projection.Supplier = _SupplierPurchasingOrg.Supplier
  association [0..1] to I_Address_2 as _AddressDefaultRepresentation on $projection.AddressID = _AddressDefaultRepresentation.AddressID
{
  key lifnr as Supplier,
      name1 as SupplierName,
      concat_with_space(name1, name2, 1) as SupplierFullName,
      ktokk as SupplierAccountGroup,
      land1 as Country,
      regio as Region,
      ort01 as CityName,
      pstlz as PostalCode,
      stras as StreetName,
      telf1 as PhoneNumber1,
      stcd1 as TaxNumber1,
      stceg as VATRegistration,
      spras as SupplierLanguage,
      adrnr as AddressID,
      kunnr as Customer,
      loevm as DeletionIndicator,
      sperr as PostingIsBlocked,
      erdat as CreationDate,
      ernam as CreatedByUser,
    _SupplierCompany,
    _SupplierPurchasingOrg,
    _AddressDefaultRepresentation
}
