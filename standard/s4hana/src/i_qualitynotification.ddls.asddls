@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Quality Notification'
@VDM.viewType: #BASIC
@ObjectModel.usageType.dataClass: #MASTER
define view entity I_QualityNotification
  as select from qmel
{
  key qmnum as QualityNotification,
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
where qmart like 'Q%'
