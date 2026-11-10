@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Business User'
@VDM.viewType: #BASIC
@ObjectModel.usageType.dataClass: #MASTER
define view entity I_BusinessUser
  as select from usr21
{
  key bname as UserID,
      persnumber as PersonID,
      addrnumber as AddressID
}
