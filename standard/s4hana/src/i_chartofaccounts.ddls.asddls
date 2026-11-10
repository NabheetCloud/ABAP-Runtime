@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Chart of Accounts'
@VDM.viewType: #BASIC
@ObjectModel.usageType.dataClass: #MASTER
define view entity I_ChartOfAccounts
  as select from t004
  association [0..*] to I_ChartOfAccountsText as _Text on $projection.ChartOfAccounts = _Text.ChartOfAccounts
{
  key ktopl as ChartOfAccounts,
      dspra as MaintenanceLanguage,
      saknr_len as GLAccountLength,
    _Text
}
