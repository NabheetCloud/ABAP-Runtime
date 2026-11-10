@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'G/L Account Balance'
@VDM.viewType: #BASIC
@ObjectModel.usageType.dataClass: #MASTER
define view entity I_GLAcctBalanceCube
  as select from acdoca
{
  key rldnr as Ledger,
  key rbukrs as CompanyCode,
  key gjahr as FiscalYear,
  key poper as FiscalPeriod,
  key racct as GLAccount,
  key rhcur as CompanyCodeCurrency,
      sum(hsl) as AmountInCompanyCodeCurrency,
      count(*) as NumberOfLineItems
}
group by rldnr, rbukrs, gjahr, poper, racct, rhcur
