@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Fiscal Year Period for Fiscal Year Variant'
@VDM.viewType: #BASIC
@ObjectModel.usageType.dataClass: #MASTER
define view entity I_FiscalYearPeriodForVariant
  as select from t009b
{
  key periv as FiscalYearVariant,
  key bdatj as CalendarYear,
  key bumon as CalendarMonth,
  key butag as CalendarDay,
      poper as FiscalPeriod,
      reljr as FiscalYearShift
}
