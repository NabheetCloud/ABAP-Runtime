@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Purchase order (form data provider)'
@ObjectModel.supportedCapabilities: [ #OUTPUT_FORM_DATA_PROVIDER ]
define root view entity ZI_PurchaseOrderDoc
  as select from zpodoc_a
  association [0..*] to ZI_PurchaseOrderDocItem as _Item          on $projection.PONumber = _Item.PONumber
  association [0..1] to I_Supplier              as _Supplier      on $projection.Supplier = _Supplier.Supplier
  association [0..1] to I_PurchasingGroup       as _PurchasingGrp on $projection.PurchasingGroup = _PurchasingGrp.PurchasingGroup
  association [0..1] to I_Plant                 as _Plant         on $projection.Plant = _Plant.Plant
  association [0..1] to I_CompanyCode           as _CompanyCode   on $projection.CompanyCode = _CompanyCode.CompanyCode
  association [0..1] to ZI_PurchaseOrderGRConf  as _GRConf        on $projection.PONumber = _GRConf.PONumber
{
  key po_number                                as PONumber,
      company_code                             as CompanyCode,
      _CompanyCode.CompanyCodeName             as CompanyCodeName,
      _CompanyCode.CityName                    as CompanyCity,
      _CompanyCode.VATRegistration             as CompanyVATRegistration,
      plant                                    as Plant,
      _Plant.PlantName                         as PlantName,
      _Plant.StreetName                        as PlantStreet,
      _Plant.PostalCode                        as PlantPostalCode,
      _Plant.CityName                          as PlantCity,
      _Plant.Country                           as PlantCountry,
      supplier                                 as Supplier,
      _Supplier.SupplierName                   as SupplierName,
      _Supplier.StreetName                     as SupplierStreet,
      _Supplier.PostalCode                     as SupplierPostalCode,
      _Supplier.CityName                       as SupplierCity,
      _Supplier.Country                        as SupplierCountry,
      _Supplier.VATRegistration                as SupplierVATRegistration,
      purchasing_group                         as PurchasingGroup,
      _PurchasingGrp.PurchasingGroupName       as PurchasingGroupName,
      _PurchasingGrp.PurchasingGroupPhoneNumber as BuyerPhone,
      _PurchasingGrp.EmailAddress              as BuyerEmail,
      buyer_name                               as BuyerName,
      order_date                               as OrderDate,
      delivery_date                            as DeliveryDate,
      currency                                 as Currency,
      status                                   as Status,
      _GRConf.ReceivedBy                       as ReceivedBy,
      _GRConf.ReceivedOn                       as ReceivedOn,
      _GRConf.IsComplete                       as IsComplete,
      _GRConf.Remark                           as Remark,
      _GRConf.IsSigned                         as IsSigned,
      _GRConf.Signer                           as Signer,
      _Item
}
