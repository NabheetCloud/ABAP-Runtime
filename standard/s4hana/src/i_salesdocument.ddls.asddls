@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Sales Document'
@VDM.viewType: #BASIC
@ObjectModel.usageType.dataClass: #MASTER
define view entity I_SalesDocument
  as select from vbak
{
  key vbeln as SalesDocument,
      auart as SalesDocumentType,
      vbtyp as SDDocumentCategory,
      vkorg as SalesOrganization,
      vtweg as DistributionChannel,
      spart as Division,
      vkbur as SalesOffice,
      vkgrp as SalesGroup,
      kunnr as Customer,
      erdat as CreationDate,
      erzet as CreationTime,
      ernam as CreatedByUser,
      audat as SalesDocumentDate,
      vdatu as RequestedDeliveryDate,
      bstnk as PurchaseOrderByCustomer,
      bstdk as CustomerPurchaseOrderDate,
      netwr as NetAmount,
      waerk as TransactionCurrency,
      knumv as PricingDocument,
      vsbed as ShippingCondition,
      augru as SDDocumentReason,
      lifsk as DeliveryBlockReason,
      faksk as HeaderBillingBlockReason,
      gbstk as OverallSDProcessStatus,
      lfstk as OverallDeliveryStatus,
      fkstk as OverallBillingStatus
}
