@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Product Group'
@VDM.viewType: #BASIC
@ObjectModel.usageType.dataClass: #MASTER
define view entity I_ProductGroup_2
  as select from t023
  association [0..*] to I_ProductGroupText_2 as _Text on $projection.ProductGroup = _Text.ProductGroup
{
  key matkl as ProductGroup,
      begru as AuthorizationGroup,
    _Text
}
