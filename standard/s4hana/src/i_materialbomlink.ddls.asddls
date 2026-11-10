@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Material BOM Link'
@VDM.viewType: #BASIC
@ObjectModel.usageType.dataClass: #MASTER
define view entity I_MaterialBOMLink
  as select from mast
{
  key matnr as Material,
  key werks as Plant,
  key stlan as BillOfMaterialVariantUsage,
  key stlnr as BillOfMaterial,
  key stlal as BillOfMaterialVariant
}
