@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Billing Document Item (Basic)'
@VDM.viewType: #BASIC
@ObjectModel.usageType.dataClass: #MASTER
define view entity I_BillingDocumentItemBasic
  as select from vbrp
{
  key vbeln as BillingDocument,
  key posnr as BillingDocumentItem,
      matnr as Material,
      fkimg as BillingQuantity,
      vrkme as OrderQuantityUnit,
      netwr as NetAmount,
      mwsbp as TaxAmount,
      werks as Plant,
      aubel as SalesDocument,
      aupos as SalesDocumentItem,
      vgbel as ReferenceSDDocument,
      vgpos as ReferenceSDDocumentItem,
      prctr as ProfitCenter,
      kostl as CostCenter,
      arktx as BillingDocumentItemText,
      charg as Batch,
      knumv as PricingDocument,
      pstyv as SalesDocumentItemCategory,
      meins as BaseUnit,
      lgort as StorageLocation,
      erdat as CreationDate,
      matkl as MaterialGroup
}
