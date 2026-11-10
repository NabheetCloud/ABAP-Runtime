@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Customer'
define view entity ZI_Customer
  as select from zcustomer_a
{
  key customer_id                          as CustomerID,
      first_name                           as FirstName,
      last_name                            as LastName,
      concat_with_space(first_name, last_name, 1) as CustomerName,
      city                                 as City,
      country_code                         as CountryCode,
      email                                as EMailAddress
}
