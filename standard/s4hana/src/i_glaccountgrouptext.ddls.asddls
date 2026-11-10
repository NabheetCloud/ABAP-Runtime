@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'G/L Account Group - Text'
@VDM.viewType: #BASIC
@ObjectModel.dataCategory: #TEXT
@ObjectModel.usageType.dataClass: #MASTER
define view entity I_GLAccountGroupText
  as select from t077z
{
  key ktopl as ChartOfAccounts,
  key ktoks as GLAccountGroup,
  key spras as Language,
      txt30 as AccountGroupName
}
