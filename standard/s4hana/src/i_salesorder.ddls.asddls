@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Sales Order'
@VDM.viewType: #BASIC
@ObjectModel.usageType.dataClass: #MASTER
define view entity I_SalesOrder
  as select from vbak
{
  key vbeln as SalesOrder,
      auart as SalesOrderType,
      vbtyp as SDDocumentCategory,
      vkorg as SalesOrganization,
      vtweg as DistributionChannel,
      spart as Division,
      vkbur as SalesOffice,
      vkgrp as SalesGroup,
      kunnr as SoldToParty,
      erdat as CreationDate,
      erzet as CreationTime,
      ernam as CreatedByUser,
      audat as SalesOrderDate,
      vdatu as RequestedDeliveryDate,
      bstnk as PurchaseOrderByCustomer,
      bstdk as CustomerPurchaseOrderDate,
      netwr as TotalNetAmount,
      waerk as TransactionCurrency,
      knumv as PricingDocument,
      vsbed as ShippingCondition,
      augru as SDDocumentReason,
      lifsk as DeliveryBlockReason,
      faksk as HeaderBillingBlockReason,
      gbstk as OverallSDProcessStatus,
      lfstk as OverallDeliveryStatus,
      fkstk as OverallBillingStatus,
      spart as OrganizationDivision,
      kunnr as ShipToParty,
      bstnk as CustomerPurchaseOrderReference
}
where vbtyp = 'C'
