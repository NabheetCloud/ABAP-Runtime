@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'G/L Account in Company Code'
@VDM.viewType: #BASIC
@ObjectModel.usageType.dataClass: #MASTER
define view entity I_GLAccountInCompanyCode
  as select from skb1
{
  key bukrs as CompanyCode,
  key saknr as GLAccount,
      waers as AccountCurrency,
      mitkz as ReconciliationAccountType,
      xspeb as AccountIsBlockedForPosting,
      xopvw as IsOpenItemManaged
}
