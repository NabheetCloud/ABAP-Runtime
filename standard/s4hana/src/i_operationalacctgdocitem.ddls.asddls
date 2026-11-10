@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Operational Accounting Document Item'
@VDM.viewType: #BASIC
@ObjectModel.usageType.dataClass: #MASTER
define view entity I_OperationalAcctgDocItem
  as select from bseg
{
  key bukrs as CompanyCode,
  key belnr as AccountingDocument,
  key gjahr as FiscalYear,
  key buzei as AccountingDocumentItem,
      bschl as PostingKey,
      koart as FinancialAccountType,
      shkzg as DebitCreditCode,
      dmbtr as AmountInCompanyCodeCurrency,
      wrbtr as AmountInTransactionCurrency,
      hkont as GLAccount,
      kunnr as Customer,
      lifnr as Supplier,
      mwskz as TaxCode,
      zuonr as AssignmentReference,
      sgtxt as DocumentItemText,
      kostl as CostCenter,
      aufnr as OrderID,
      prctr as ProfitCenter,
      augbl as ClearingJournalEntry,
      augdt as ClearingDate,
      zfbdt as DueCalculationBaseDate,
      zterm as PaymentTerms,
      matnr as Material,
      werks as Plant,
      menge as Quantity,
      meins as BaseUnit,
      ebeln as PurchaseOrder,
      ebelp as PurchaseOrderItem,
      anln1 as MasterFixedAsset,
      anln2 as FixedAsset,
      vbeln as SalesDocument,
      segment as Segment
}
