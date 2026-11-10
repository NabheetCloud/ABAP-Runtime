@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Network Activity'
@VDM.viewType: #BASIC
@ObjectModel.usageType.dataClass: #MASTER
define view entity I_NetworkActivity
  as select from afvc
{
  key aufpl as ProjectNetworkInternalID,
  key aplzl as NetworkActivityInternalID,
      vornr as NetworkActivity,
      arbid as WorkCenterInternalID,
      ltxa1 as NetworkActivityDescription,
      objnr as MaintObjectInternalID,
      rueck as MfgOrderConfirmationGroup,
      aufnr as OrderID,
      rmzhl as MfgOrderConfirmation,
      werks as Plant
}
where objnr like 'NV%'
