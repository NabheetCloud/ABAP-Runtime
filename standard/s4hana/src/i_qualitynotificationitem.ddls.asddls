@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Quality Notification Item'
@VDM.viewType: #BASIC
@ObjectModel.usageType.dataClass: #MASTER
define view entity I_QualityNotificationItem
  as select from qmfe
{
  key qmnum as QualityNotification,
  key fenum as NotificationItem,
      fegrp as DefectCodeGroup,
      fecod as DefectCode,
      fetxt as NotificationItemText
}
