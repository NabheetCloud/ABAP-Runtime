@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Fiscal Year Variant'
@VDM.viewType: #BASIC
@ObjectModel.usageType.dataClass: #MASTER
define view entity I_FiscalYearVariant
  as select from t009
  association [0..*] to I_FiscalYearVariantText as _Text on $projection.FiscalYearVariant = _Text.FiscalYearVariant
{
  key periv as FiscalYearVariant,
      anzbp as NumberOfPostingPeriods,
      anzsp as NumberOfSpecialPeriods,
    _Text
}
