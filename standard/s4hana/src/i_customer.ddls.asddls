@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Customer'
@VDM.viewType: #BASIC
@ObjectModel.usageType.dataClass: #MASTER
define view entity I_Customer
  as select from kna1
  association [0..*] to I_CustomerCompany as _CustomerCompany on $projection.Customer = _CustomerCompany.Customer
  association [0..*] to I_CustomerSalesArea as _CustomerSalesArea on $projection.Customer = _CustomerSalesArea.Customer
  association [0..1] to I_Address_2 as _AddressDefaultRepresentation on $projection.AddressID = _AddressDefaultRepresentation.AddressID
{
  key kunnr as Customer,
      name1 as CustomerName,
      concat_with_space(name1, name2, 1) as CustomerFullName,
      ktokd as CustomerAccountGroup,
      land1 as Country,
      regio as Region,
      ort01 as CityName,
      pstlz as PostalCode,
      stras as StreetName,
      telf1 as TelephoneNumber1,
      stcd1 as TaxNumber1,
      stceg as VATRegistration,
      spras as Language,
      adrnr as AddressID,
      lifnr as Supplier,
      loevm as DeletionIndicator,
      aufsd as OrderIsBlockedForCustomer,
      erdat as CreationDate,
      ernam as CreatedByUser,
    _CustomerCompany,
    _CustomerSalesArea,
    _AddressDefaultRepresentation
}
