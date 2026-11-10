@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Project Status'
@VDM.viewType: #BASIC
@ObjectModel.usageType.dataClass: #MASTER
define view entity I_ProjectStatus
  as select from jest
{
  key objnr as StatusObject,
  key stat as StatusCode,
      inact as StatusIsInactive
}
where objnr like 'P%'
