@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Product Type'
@VDM.viewType: #BASIC
@ObjectModel.usageType.dataClass: #MASTER
define view entity I_ProductType
  as select from t134
  association [0..*] to I_ProductTypeText as _Text on $projection.ProductType = _Text.ProductType
{
  key mtart as ProductType,
      mtref as ProductTypeReference,
    _Text
}
