@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Journal Entry'
@VDM.viewType: #BASIC
@ObjectModel.usageType.dataClass: #MASTER
define view entity I_JournalEntry
  as select from bkpf
{
  key bukrs as CompanyCode,
  key gjahr as FiscalYear,
  key belnr as AccountingDocument,
      blart as AccountingDocumentType,
      bldat as DocumentDate,
      budat as PostingDate,
      monat as FiscalPeriod,
      usnam as AccountingDocCreatedByUser,
      tcode as TransactionCode,
      waers as Currency,
      xblnr as DocumentReferenceID,
      bktxt as AccountingDocumentHeaderText,
      awtyp as ReferenceDocumentType,
      cpudt as AccountingDocumentCreationDate,
      cputm as CreationTime,
      kursf as ExchangeRate,
      stblg as ReverseDocument,
      bstat as AccountingDocumentCategory,
      hwaer as CompanyCodeCurrency
}
