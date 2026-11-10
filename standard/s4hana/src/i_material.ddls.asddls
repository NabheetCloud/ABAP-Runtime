@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Material'
@VDM.viewType: #BASIC
@ObjectModel.usageType.dataClass: #MASTER
define view entity I_Material
  as select from mara
{
  key matnr as Material,
      mtart as MaterialType,
      matkl as MaterialGroup,
      meins as MaterialBaseUnit,
      ntgew as NetWeight,
      gewei as WeightUnit,
      spart as Division,
      ernam as CreatedByUser
}
