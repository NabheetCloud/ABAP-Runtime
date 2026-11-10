@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Address'
@VDM.viewType: #BASIC
@ObjectModel.usageType.dataClass: #MASTER
define view entity I_Address_2
  as select from adrc
{
  key addrnumber as AddressID,
      name1 as OrganizationName1,
      name2 as OrganizationName2,
      street as StreetName,
      house_num1 as HouseNumber,
      post_code1 as PostalCode,
      city1 as CityName,
      country as Country,
      region as Region,
      langu as CorrespondenceLanguage,
      tel_number as PhoneNumber,
      smtp_addr as EmailAddress
}
where nation = ' '
