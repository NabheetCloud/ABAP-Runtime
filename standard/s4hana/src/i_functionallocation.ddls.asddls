@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Functional Location'
@VDM.viewType: #BASIC
@ObjectModel.usageType.dataClass: #MASTER
define view entity I_FunctionalLocation
  as select from iflot
{
  key tplnr as FunctionalLocation,
      fltyp as FunctionalLocationCategory,
      iwerk as MaintenancePlanningPlant,
      swerk as MaintenancePlant,
      objnr as MaintObjectInternalID,
      erdat as CreationDate,
      ernam as CreatedByUser
}
