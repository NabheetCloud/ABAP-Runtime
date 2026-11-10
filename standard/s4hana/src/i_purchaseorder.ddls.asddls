@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Purchase Order'
@VDM.viewType: #BASIC
@ObjectModel.usageType.dataClass: #MASTER
define view entity I_PurchaseOrder
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
      waers as DocumentCurrency,
      zterm as PaymentTerms,
      inco1 as IncotermsClassification,
      knumv as PricingDocument,
      frgke as ReleaseCode,
      statu as PurchasingDocumentStatus,
      loekz as PurchasingDocumentDeletionCode,
      aedat as CreationDate,
      ernam as CreatedByUser,
      inco2 as IncotermsLocation1,
      adrnr as AddressID,
      frgke as ReleaseIsNotCompleted
}
