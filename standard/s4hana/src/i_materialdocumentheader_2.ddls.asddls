@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Material Document Header'
@VDM.viewType: #BASIC
@ObjectModel.usageType.dataClass: #MASTER
define view entity I_MaterialDocumentHeader_2
  as select from matdoc
{
  key mjahr as MaterialDocumentYear,
  key mblnr as MaterialDocument,
      zeile as MaterialDocumentItem,
      bwart as GoodsMovementType,
      matnr as Material,
      werks as Plant,
      lgort as StorageLocation,
      charg as Batch,
      menge as Quantity,
      meins as BaseUnit,
      shkzg as DebitCreditCode,
      sobkz as InventorySpecialStockType,
      aufnr as OrderID,
      budat as PostingDate,
      xblnr as DocumentReferenceID,
      lifnr as Supplier,
      kunnr as Customer,
      kdauf as SalesOrder,
      kdpos as SalesOrderItem,
      erfmg as QuantityInEntryUnit,
      erfme as EntryUnit,
      dmbtr as AmountInCompanyCodeCurrency,
      waers as Currency,
      bldat as DocumentDate,
      cpudt as CreationDate,
      usnam as CreatedByUser,
      ebeln as PurchaseOrder,
      ebelp as PurchaseOrderItem,
      kostl as CostCenter,
      rsnum as Reservation,
      rspos as ReservationItem,
      vbeln_im as DeliveryDocument,
      vbelp_im as DeliveryDocumentItem,
      sjahr as ReversedMaterialDocumentYear,
      smbln as ReversedMaterialDocument,
      smblp as ReversedMaterialDocumentItem,
      stock_qty as MatlWrhsStkQtyInMatlBaseUnit,
      cputm as CreationTime,
      bktxt as AccountingDocumentHeaderText,
      sgtxt as DocumentItemText
}
where zeile = '0001'
