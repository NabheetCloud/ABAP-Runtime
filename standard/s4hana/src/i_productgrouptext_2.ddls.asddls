@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Product Group - Text'
@VDM.viewType: #BASIC
@ObjectModel.dataCategory: #TEXT
@ObjectModel.usageType.dataClass: #MASTER
define view entity I_ProductGroupText_2
  as select from t023t
{
  key matkl as ProductGroup,
  key spras as Language,
      wgbez as ProductGroupName,
      wgbez60 as ProductGroupText
}
