@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Product Units of Measure'
@VDM.viewType: #BASIC
@ObjectModel.usageType.dataClass: #MASTER
define view entity I_ProductUnitsOfMeasure
  as select from marm
{
  key matnr as Product,
  key meinh as AlternativeUnit,
      umrez as QuantityNumerator,
      umren as QuantityDenominator,
      ean11 as ProductStandardID
}
