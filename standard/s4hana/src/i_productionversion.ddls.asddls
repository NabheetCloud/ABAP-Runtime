@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Production Version'
@VDM.viewType: #BASIC
@ObjectModel.usageType.dataClass: #MASTER
define view entity I_ProductionVersion
  as select from mkal
{
  key matnr as Material,
  key werks as Plant,
  key verid as ProductionVersion,
      adatu as ValidityStartDate,
      bdatu as ValidityEndDate,
      stlal as BillOfMaterialVariant,
      stlan as BillOfMaterialVariantUsage,
      text1 as ProductionVersionText
}
