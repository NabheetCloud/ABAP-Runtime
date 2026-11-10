@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Purchase Order Item'
@VDM.viewType: #BASIC
@ObjectModel.usageType.dataClass: #MASTER
define view entity I_PurchaseOrderItem
  as select from ekpo
{
  key ebeln as PurchaseOrder,
  key ebelp as PurchaseOrderItem,
      matnr as Material,
      txz01 as PurchaseOrderItemText,
      werks as Plant,
      lgort as StorageLocation,
      matkl as MaterialGroup,
      menge as OrderQuantity,
      meins as PurchaseOrderQuantityUnit,
      netpr as NetPriceAmount,
      peinh as NetPriceQuantity,
      netwr as NetAmount,
      brtwr as GrossAmount,
      pstyp as PurchaseOrderItemCategory,
      knttp as AccountAssignmentCategory,
      elikz as IsCompletelyDelivered,
      erekz as IsFinallyInvoiced,
      wepos as GoodsReceiptIsExpected,
      repos as InvoiceIsExpected,
      webre as InvoiceIsGoodsReceiptBased,
      mwskz as TaxCode,
      banfn as PurchaseRequisition,
      bnfpo as PurchaseRequisitionItem,
      infnr as PurchasingInfoRecord,
      loekz as PurchasingDocumentDeletionCode,
      ematn as SupplierMaterialNumber,
      aedat as LastChangeDate
}
