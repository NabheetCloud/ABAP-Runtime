@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Division - Text'
@VDM.viewType: #BASIC
@ObjectModel.dataCategory: #TEXT
@ObjectModel.usageType.dataClass: #MASTER
define view entity I_DivisionText
  as select from tspat
{
  key spart as Division,
  key spras as Language,
      vtext as DivisionName
}
