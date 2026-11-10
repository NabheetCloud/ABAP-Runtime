@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Supplier Account Group - Text'
@VDM.viewType: #BASIC
@ObjectModel.dataCategory: #TEXT
@ObjectModel.usageType.dataClass: #MASTER
define view entity I_SupplierAccountGroupText
  as select from t077y
{
  key ktokk as SupplierAccountGroup,
  key spras as Language,
      txt30 as AccountGroupName
}
