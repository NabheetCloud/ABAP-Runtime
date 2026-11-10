@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Fiscal Year Variant - Text'
@VDM.viewType: #BASIC
@ObjectModel.dataCategory: #TEXT
@ObjectModel.usageType.dataClass: #MASTER
define view entity I_FiscalYearVariantText
  as select from t009t
{
  key periv as FiscalYearVariant,
  key spras as Language,
      ltext as FiscalYearVariantName
}
