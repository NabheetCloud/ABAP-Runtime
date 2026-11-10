@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Quality Notification Task'
@VDM.viewType: #BASIC
@ObjectModel.usageType.dataClass: #MASTER
define view entity I_QualityNotificationTask
  as select from qmsm
{
  key qmnum as QualityNotification,
  key manum as NotificationTask,
      pster as PlannedStartDate,
      peter as PlannedEndDate,
      matxt as NotificationTaskText
}
