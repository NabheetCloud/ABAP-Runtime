@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'G/L Account in Chart of Accounts'
@VDM.viewType: #BASIC
@ObjectModel.usageType.dataClass: #MASTER
define view entity I_GLAccountInChartOfAccounts
  as select from ska1
  association [0..*] to I_GLAccountText as _Text on $projection.ChartOfAccounts = _Text.ChartOfAccounts and $projection.GLAccount = _Text.GLAccount
{
  key ktopl as ChartOfAccounts,
  key saknr as GLAccount,
      xbilk as IsBalanceSheetAccount,
      gvtyp as ProfitLossAccountType,
      ktoks as GLAccountGroup,
      glaccount_type as GLAccountType,
    _Text
}
