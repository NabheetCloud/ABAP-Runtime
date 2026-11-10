@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Bill of Material'
@VDM.viewType: #BASIC
@ObjectModel.usageType.dataClass: #MASTER
define view entity I_BillOfMaterial
  as select from stko
{
  key stlty as BillOfMaterialCategory,
  key stlnr as BillOfMaterial,
  key stlal as BillOfMaterialVariant,
  key stkoz as BOMHeaderInternalChangeCount,
      bmeng as BOMHeaderQuantityInBaseUnit,
      bmein as BOMHeaderBaseUnit,
      loekz as PurchasingDocumentDeletionCode
}
