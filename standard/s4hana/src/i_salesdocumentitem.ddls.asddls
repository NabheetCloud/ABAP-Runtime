@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Sales Document Item'
@VDM.viewType: #BASIC
@ObjectModel.usageType.dataClass: #MASTER
define view entity I_SalesDocumentItem
  as select from vbap
{
  key vbeln as SalesDocument,
  key posnr as SalesDocumentItem,
      matnr as Material,
      arktx as SalesDocumentItemText,
      pstyv as SalesDocumentItemCategory,
      uepos as HigherLevelItem,
      abgru as SalesDocumentRjcnReason,
      kwmeng as OrderQuantity,
      vrkme as OrderQuantityUnit,
      meins as BaseUnit,
      netwr as NetAmount,
      netpr as NetPriceAmount,
      waerk as TransactionCurrency,
      werks as Plant,
      lgort as StorageLocation,
      vstel as ShippingPoint,
      route as Route,
      charg as Batch,
      prctr as ProfitCenter,
      vgbel as ReferenceSDDocument,
      vgpos as ReferenceSDDocumentItem,
      gbsta as SDProcessStatus,
      lfsta as DeliveryStatus,
      fksaa as OrderRelatedBillingStatus,
      matkl as MaterialGroup,
      kpein as ConditionQuantity,
      kmein as ConditionQuantityUnit,
      knumv as PricingDocument,
      erdat as CreationDate,
      ernam as CreatedByUser,
      mwsbp as TaxAmount
}
