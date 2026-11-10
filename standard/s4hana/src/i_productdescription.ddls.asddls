@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Product Description'
@VDM.viewType: #BASIC
@ObjectModel.dataCategory: #TEXT
@ObjectModel.usageType.dataClass: #MASTER
define view entity I_ProductDescription
  as select from makt
{
  key matnr as Product,
  key spras as Language,
      maktx as ProductDescription
}
