@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Cost Center - Text'
@VDM.viewType: #BASIC
@ObjectModel.dataCategory: #TEXT
@ObjectModel.usageType.dataClass: #MASTER
define view entity I_CostCenterText
  as select from cskt
{
  key kokrs as ControllingArea,
  key kostl as CostCenter,
  key datbi as ValidityEndDate,
  key spras as Language,
      ktext as CostCenterName,
      ltext as CostCenterDescription
}
