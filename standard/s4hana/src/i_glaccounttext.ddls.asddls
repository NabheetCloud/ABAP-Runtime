@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'G/L Account - Text'
@VDM.viewType: #BASIC
@ObjectModel.dataCategory: #TEXT
@ObjectModel.usageType.dataClass: #MASTER
define view entity I_GLAccountText
  as select from skat
{
  key ktopl as ChartOfAccounts,
  key saknr as GLAccount,
  key spras as Language,
      txt20 as GLAccountName,
      txt50 as GLAccountLongName
}
