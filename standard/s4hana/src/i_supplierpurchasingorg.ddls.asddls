@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Supplier Purchasing Organization'
@VDM.viewType: #BASIC
@ObjectModel.usageType.dataClass: #MASTER
define view entity I_SupplierPurchasingOrg
  as select from lfm1
{
  key lifnr as Supplier,
  key ekorg as PurchasingOrganization,
      waers as PurchaseOrderCurrency,
      zterm as PaymentTerms,
      inco1 as IncotermsClassification,
      inco2 as IncotermsTransferLocation,
      webre as InvoiceIsGoodsReceiptBased,
      verkf as SupplierRespSalesPersonName,
      telf1 as SupplierPhoneNumber,
      loevm as DeletionIndicator
}
