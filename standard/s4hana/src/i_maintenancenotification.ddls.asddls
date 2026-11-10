@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Maintenance Notification'
@VDM.viewType: #BASIC
@ObjectModel.usageType.dataClass: #MASTER
define view entity I_MaintenanceNotification
  as select from qmel
{
  key qmnum as MaintenanceNotification,
      qmart as NotificationType,
      qmtxt as NotificationText,
      equnr as Equipment,
      tplnr as FunctionalLocation,
      matnr as Material,
      prueflos as InspectionLot,
      aufnr as OrderID,
      priok as MaintPriority,
      qmdat as NotificationCreationDate,
      objnr as MaintObjectInternalID,
      ernam as CreatedByUser,
      erdat as CreationDate,
      iwerk as MaintenancePlanningPlant
}
