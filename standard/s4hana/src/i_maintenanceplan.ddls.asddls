@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Maintenance Plan'
@VDM.viewType: #BASIC
@ObjectModel.usageType.dataClass: #MASTER
define view entity I_MaintenancePlan
  as select from mpla
{
  key warpl as MaintenancePlan,
      wptxt as MaintenancePlanDesc,
      strat as MaintenanceStrategy,
      erdat as CreationDate,
      ernam as CreatedByUser
}
