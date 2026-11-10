@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Unit of Measure'
@VDM.viewType: #BASIC
@ObjectModel.usageType.dataClass: #MASTER
define view entity I_UnitOfMeasure
  as select from t006
  association [0..*] to I_UnitOfMeasureText as _Text on $projection.UnitOfMeasure = _Text.UnitOfMeasure
{
  key msehi as UnitOfMeasure,
      msehi as UnitOfMeasureSAPCode,
      isocode as UnitOfMeasureISOCode,
      dimid as UnitOfMeasureDimension,
      andec as UnitOfMeasureNumberOfDecimals,
      primary as IsPrimaryUnitForISOCode,
    _Text
}
