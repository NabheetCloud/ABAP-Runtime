@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'G/L Account Group'
@VDM.viewType: #BASIC
@ObjectModel.usageType.dataClass: #MASTER
define view entity I_GLAccountGroup
  as select from t077s
  association [0..*] to I_GLAccountGroupText as _Text on $projection.ChartOfAccounts = _Text.ChartOfAccounts and $projection.GLAccountGroup = _Text.GLAccountGroup
{
  key ktopl as ChartOfAccounts,
  key ktoks as GLAccountGroup,
    _Text
}
