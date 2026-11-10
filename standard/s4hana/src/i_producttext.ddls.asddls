@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Product - Text'
@VDM.viewType: #BASIC
@ObjectModel.dataCategory: #TEXT
@ObjectModel.usageType.dataClass: #MASTER
define view entity I_ProductText
  as select from makt
{
  key matnr as Product,
  key spras as Language,
      maktx as ProductName
}
