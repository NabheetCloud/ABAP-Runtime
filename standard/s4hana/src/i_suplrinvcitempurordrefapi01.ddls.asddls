@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Supplier Invoice Item with Purchase Order Reference (API)'
@VDM.viewType: #BASIC
@ObjectModel.usageType.dataClass: #MASTER
define view entity I_SuplrInvcItemPurOrdRefAPI01
  as select from rseg
{
  key belnr as SupplierInvoice,
  key gjahr as FiscalYear,
  key buzei as SupplierInvoiceItem,
      ebeln as PurchaseOrder,
      ebelp as PurchaseOrderItem,
      matnr as Material,
      werks as Plant,
      wrbtr as SupplierInvoiceItemAmount,
      menge as QuantityInPurchaseOrderUnit,
      bstme as PurchaseOrderQuantityUnit,
      mwskz as TaxCode,
      lfbnr as ReferenceDocument,
      lfgja as ReferenceDocumentFiscalYear,
      lfpos as ReferenceDocumentItem,
      shkzg as DebitCreditCode,
      bukrs as CompanyCode,
      kschl as ConditionType
}
