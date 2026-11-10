@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Supplier Invoice (API)'
@VDM.viewType: #BASIC
@ObjectModel.usageType.dataClass: #MASTER
define view entity I_SupplierInvoiceAPI01
  as select from rbkp
{
  key belnr as SupplierInvoice,
  key gjahr as FiscalYear,
      bukrs as CompanyCode,
      lifnr as InvoicingParty,
      bldat as DocumentDate,
      budat as PostingDate,
      xblnr as SupplierInvoiceIDByInvcgParty,
      rmwwr as InvoiceGrossAmount,
      wmwst1 as TaxAmount,
      waers as Currency,
      rbstat as SupplierInvoiceStatus,
      zterm as PaymentTerms,
      stblg as ReverseDocument,
      buzei as AccountingDocumentItem,
      blart as AccountingDocumentType,
      cpudt as CreationDate,
      kursf as ExchangeRate,
      usnam as CreatedByUser
}
