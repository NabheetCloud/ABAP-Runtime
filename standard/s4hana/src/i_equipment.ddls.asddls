@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Equipment'
@VDM.viewType: #BASIC
@ObjectModel.usageType.dataClass: #MASTER
define view entity I_Equipment
  as select from equi
{
  key equnr as Equipment,
      eqtyp as EquipmentCategory,
      eqart as TechnicalObjectType,
      herst as AssetManufacturerName,
      serge as ManufacturerSerialNumber,
      matnr as Material,
      sernr as SerialNumber,
      baujj as ConstructionYear,
      objnr as MaintObjectInternalID,
      inbdt as StartupDate,
      erdat as CreationDate,
      ernam as CreatedByUser
}
