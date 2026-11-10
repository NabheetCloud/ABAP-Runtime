@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Purchase Requisition Item'
@VDM.viewType: #BASIC
@ObjectModel.usageType.dataClass: #MASTER
define view entity I_PurchaseRequisitionItem
  as select from eban
{
  key banfn as PurchaseRequisition,
  key bnfpo as PurchaseRequisitionItem,
      bsart as PurchaseRequisitionType,
      matnr as Material,
      werks as Plant,
      lgort as StorageLocation,
      menge as RequestedQuantity,
      meins as BaseUnit,
      badat as PurchaseRequisitionReleaseDate,
      lfdat as DeliveryDate,
      ekgrp as PurchasingGroup,
      ekorg as PurchasingOrganization,
      flief as FixedSupplier,
      knttp as AccountAssignmentCategory,
      ebeln as PurchaseOrder,
      ebelp as PurchaseOrderItem,
      frgkz as PurReqnReleaseStatus,
      loekz as PurchasingDocumentDeletionCode,
      txz01 as PurchaseRequisitionItemText,
      matkl as MaterialGroup,
      bstyp as PurchasingDocumentCategory,
      erdat as CreationDate,
      ernam as CreatedByUser,
      statu as PurchasingDocumentStatus,
      waers as Currency
}
