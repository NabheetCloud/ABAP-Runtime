@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Maintenance Item'
@VDM.viewType: #BASIC
@ObjectModel.usageType.dataClass: #MASTER
define view entity I_MaintenanceItem
  as select from mpos
{
  key wapos as MaintenanceItem,
      warpl as MaintenancePlan,
      equnr as Equipment,
      tplnr as FunctionalLocation,
      auart as SalesDocumentType,
      iwerk as MaintenancePlanningPlant,
      pstxt as MaintenanceItemDescription
}
