@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Unit of Measure - Text'
@VDM.viewType: #BASIC
@ObjectModel.dataCategory: #TEXT
@ObjectModel.usageType.dataClass: #MASTER
define view entity I_UnitOfMeasureText
  as select from t006a
{
  key msehi as UnitOfMeasure,
  key spras as Language,
      mseh6 as UnitOfMeasureName,
      msehl as UnitOfMeasureLongName,
      mseh3 as UnitOfMeasureCommercialName
}
