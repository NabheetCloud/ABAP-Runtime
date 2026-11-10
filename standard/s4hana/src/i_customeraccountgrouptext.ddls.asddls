@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Customer Account Group - Text'
@VDM.viewType: #BASIC
@ObjectModel.dataCategory: #TEXT
@ObjectModel.usageType.dataClass: #MASTER
define view entity I_CustomerAccountGroupText
  as select from t077x
{
  key ktokd as CustomerAccountGroup,
  key spras as Language,
      txt30 as AccountGroupName
}
