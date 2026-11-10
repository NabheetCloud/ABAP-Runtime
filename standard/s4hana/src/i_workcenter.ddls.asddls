@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Work Center'
@VDM.viewType: #BASIC
@ObjectModel.usageType.dataClass: #MASTER
define view entity I_WorkCenter
  as select from crhd
{
  key objty as WorkCenterTypeCode,
  key objid as WorkCenterInternalID,
      arbpl as WorkCenter,
      werks as Plant,
      verwe as WorkCenterCategoryCode,
      ktext as OrderDescription
}
