@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Purchase Order (API)'
@VDM.viewType: #BASIC
@ObjectModel.usageType.dataClass: #MASTER
define view entity I_PurchaseOrderAPI01
  as select from ekko
{
  key ebeln as PurchaseOrder,
      bukrs as CompanyCode,
      bstyp as PurchasingDocumentCategory,
      bsart as PurchaseOrderType,
      lifnr as Supplier,
      ekorg as PurchasingOrganization,
      ekgrp as PurchasingGroup,
      bedat as PurchaseOrderDate,
      waers as Currency,
      zterm as PaymentTerms,
      inco1 as IncotermsClassification,
      knumv as PricingDocument,
      frgke as ReleaseCode,
      statu as PurchasingDocumentStatus,
      loekz as PurchasingDocumentDeletionCode,
      aedat as CreationDate,
      ernam as CreatedByUser,
      inco2 as IncotermsTransferLocation,
      adrnr as AddressID
}
