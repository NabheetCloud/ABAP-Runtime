@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Purchasing Info Record'
@VDM.viewType: #BASIC
@ObjectModel.usageType.dataClass: #MASTER
define view entity I_PurchasingInfoRecord
  as select from eina
{
  key infnr as PurchasingInfoRecord,
      matnr as Material,
      lifnr as Supplier,
      matkl as MaterialGroup,
      meins as BaseUnit,
      idnlf as SupplierMaterialNumber,
      erdat as CreationDate,
      ernam as CreatedByUser
}
