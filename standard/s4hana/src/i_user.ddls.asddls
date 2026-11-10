@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'User'
@VDM.viewType: #BASIC
@ObjectModel.usageType.dataClass: #MASTER
define view entity I_User
  as select from usr02
{
  key bname as UserID,
      ustyp as UserType,
      gltgv as ValidityStartDate,
      gltgb as ValidityEndDate,
      uflag as UserLockStatus,
      trdat as LastLogonDate,
      class as Class
}
