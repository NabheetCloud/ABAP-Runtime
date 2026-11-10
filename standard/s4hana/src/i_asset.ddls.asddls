@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Asset'
@VDM.viewType: #BASIC
@ObjectModel.usageType.dataClass: #MASTER
define view entity I_Asset
  as select from anla
{
  key bukrs as CompanyCode,
  key anln1 as MasterFixedAsset,
  key anln2 as FixedAsset,
      anlkl as AssetClass,
      aktiv as AssetCapitalizationDate,
      deakt as AssetDeactivationDate,
      txt50 as FixedAssetDescription,
      invnr as InventoryNumber,
      menge as Quantity,
      meins as BaseUnit,
      lifnr as Supplier,
      sernr as SerialNumber,
      herst as AssetManufacturerName,
      kostl as CostCenter,
      werks as Plant,
      erdat as CreationDate,
      ernam as CreatedByUser
}
