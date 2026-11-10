@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Billing Document'
@VDM.viewType: #BASIC
@ObjectModel.usageType.dataClass: #MASTER
define view entity I_BillingDocument
  as select from vbrk
{
  key vbeln as BillingDocument,
      fkart as BillingDocumentType,
      vbtyp as SDDocumentCategory,
      vkorg as SalesOrganization,
      vtweg as DistributionChannel,
      fkdat as BillingDocumentDate,
      kunrg as PayerParty,
      kunag as SoldToParty,
      netwr as TotalNetAmount,
      mwsbk as TaxAmount,
      waerk as TransactionCurrency,
      knumv as PricingDocument,
      bukrs as CompanyCode,
      rfbsk as AccountingTransferStatus,
      fksto as BillingDocumentIsCancelled,
      sfakn as CancelledBillingDocument,
      xblnr as DocumentReferenceID,
      zterm as PaymentTerms,
      erdat as CreationDate,
      ernam as CreatedByUser,
      spart as Division,
      belnr as AccountingDocument,
      gjahr as FiscalYear,
      erzet as CreationTime,
      inco1 as IncotermsClassification
}
