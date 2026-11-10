@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Product'
@VDM.viewType: #BASIC
@ObjectModel.usageType.dataClass: #MASTER
define view entity I_Product
  as select from mara
  association [0..*] to I_ProductDescription as _Text on $projection.Product = _Text.Product
  association [0..*] to I_ProductPlantBasic as _ProductPlant on $projection.Product = _ProductPlant.Product
  association [0..1] to I_ProductType as _ProductType on $projection.ProductType = _ProductType.ProductType
  association [0..1] to I_ProductGroup_2 as _ProductGroup on $projection.ProductGroup = _ProductGroup.ProductGroup
{
  key matnr as Product,
      mtart as ProductType,
      matkl as ProductGroup,
      meins as BaseUnit,
      brgew as GrossWeight,
      ntgew as NetWeight,
      gewei as WeightUnit,
      volum as MaterialVolume,
      voleh as VolumeUnit,
      spart as Division,
      bismt as ProductOldID,
      ean11 as ProductStandardID,
      mstae as CrossPlantStatus,
      lvorm as IsMarkedForDeletion,
      ersda as CreationDate,
      ernam as CreatedByUser,
      laeda as LastChangeDate,
    _Text,
    _ProductPlant,
    _ProductType,
    _ProductGroup
}
