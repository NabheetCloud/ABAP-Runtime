@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Customer'
@Search.searchable: true
define view entity ZI_SOCustomer
  as select from zsocustomer_a
{
  key customer_id  as CustomerID,
      @Search.defaultSearchElement: true
      name         as CustomerName,
      city         as City,
      country_code as CountryCode,
      email        as EMailAddress
}
