@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Bill of Material Item'
@VDM.viewType: #BASIC
@ObjectModel.usageType.dataClass: #MASTER
define view entity I_BillOfMaterialItemBasic
  as select from stpo
{
  key stlty as BillOfMaterialCategory,
  key stlnr as BillOfMaterial,
  key stlkn as BillOfMaterialItemNodeNumber,
  key stpoz as BOMItemInternalChangeCount,
      idnrk as BillOfMaterialComponent,
      posnr as BillOfMaterialItemNumber,
      postp as BillOfMaterialItemCategory,
      menge as BillOfMaterialItemQuantity,
      meins as BillOfMaterialItemUnit,
      lgort as StorageLocation
}
