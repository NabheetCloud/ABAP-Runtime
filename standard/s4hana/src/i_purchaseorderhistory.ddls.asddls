@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Purchase Order History'
@VDM.viewType: #BASIC
@ObjectModel.usageType.dataClass: #MASTER
define view entity I_PurchaseOrderHistory
  as select from ekbe
{
  key ebeln as PurchaseOrder,
  key ebelp as PurchaseOrderItem,
  key zekkn as AccountAssignmentNumber,
  key vgabe as PurchasingHistoryDocumentType,
  key gjahr as PurchasingHistoryDocumentYear,
  key belnr as PurchasingHistoryDocument,
  key buzei as PurchasingHistoryDocumentItem,
      bewtp as PurchasingHistoryCategory,
      bwart as GoodsMovementType,
      budat as PostingDate,
      menge as Quantity,
      dmbtr as AmountInCompanyCodeCurrency,
      wrbtr as AmountInTransactionCurrency,
      shkzg as DebitCreditCode,
      lfbnr as ReferenceDocument,
      lfgja as ReferenceDocumentFiscalYear,
      lfpos as ReferenceDocumentItem,
      cpudt as CreationDate,
      ernam as CreatedByUser,
      matnr as Material,
      waers as Currency,
      werks as Plant
}
