@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Product Type - Text'
@VDM.viewType: #BASIC
@ObjectModel.dataCategory: #TEXT
@ObjectModel.usageType.dataClass: #MASTER
define view entity I_ProductTypeText
  as select from t134t
{
  key mtart as ProductType,
  key spras as Language,
      mtbez as ProductTypeName
}
