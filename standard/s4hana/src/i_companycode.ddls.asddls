@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Company Code'
@VDM.viewType: #BASIC
@ObjectModel.usageType.dataClass: #MASTER
define view entity I_CompanyCode
  as select from t001
  association [0..1] to I_Country as _Country on $projection.Country = _Country.Country
  association [0..1] to I_Currency as _Currency on $projection.Currency = _Currency.Currency
  association [0..1] to I_ChartOfAccounts as _ChartOfAccounts on $projection.ChartOfAccounts = _ChartOfAccounts.ChartOfAccounts
{
  key bukrs as CompanyCode,
      butxt as CompanyCodeName,
      ort01 as CityName,
      land1 as Country,
      waers as Currency,
      spras as Language,
      ktopl as ChartOfAccounts,
      periv as FiscalYearVariant,
      rcomp as Company,
      stceg as VATRegistration,
    _Country,
    _Currency,
    _ChartOfAccounts
}
