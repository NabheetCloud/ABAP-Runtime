@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Purchasing Source List'
@VDM.viewType: #BASIC
@ObjectModel.usageType.dataClass: #MASTER
define view entity I_PurchasingSourceList
  as select from eord
{
  key matnr as Material,
  key werks as Plant,
  key zeord as SourceListRecord,
      vdatu as ValidityStartDate,
      bdatu as ValidityEndDate,
      lifnr as Supplier,
      ekorg as PurchasingOrganization,
      ebeln as PurchaseOrder,
      ebelp as PurchaseOrderItem,
      flifn as SupplierIsFixed,
      notkz as SourceOfSupplyIsBlocked,
      erdat as CreationDate,
      ernam as CreatedByUser
}
