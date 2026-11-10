@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'G/L Account Text (Raw Data)'
@VDM.viewType: #BASIC
@ObjectModel.usageType.dataClass: #MASTER
define view entity I_GLAccountTextRawData
  as select from skat
{
  key ktopl as ChartOfAccounts,
  key saknr as GLAccount,
  key spras as Language,
      txt20 as GLAccountName,
      txt50 as GLAccountLongName
}
