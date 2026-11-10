@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Purchasing Info Record (API)'
@VDM.viewType: #BASIC
@ObjectModel.usageType.dataClass: #MASTER
define view entity I_PurchasingInfoRecordApi01
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
