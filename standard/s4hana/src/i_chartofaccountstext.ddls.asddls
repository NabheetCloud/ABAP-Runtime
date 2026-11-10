@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Chart of Accounts - Text'
@VDM.viewType: #BASIC
@ObjectModel.dataCategory: #TEXT
@ObjectModel.usageType.dataClass: #MASTER
define view entity I_ChartOfAccountsText
  as select from t004t
{
  key ktopl as ChartOfAccounts,
  key spras as Language,
      ktplt as ChartOfAccountsName
}
