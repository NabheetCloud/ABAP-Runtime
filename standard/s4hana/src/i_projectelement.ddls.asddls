@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Project Element'
@VDM.viewType: #BASIC
@ObjectModel.usageType.dataClass: #MASTER
define view entity I_ProjectElement
  as select from prps
{
  key pspnr as ProjectElementInternalID,
      posid as ProjectElement,
      psphi as ProjectInternalID,
      objnr as MaintObjectInternalID,
      prctr as ProfitCenter,
      erdat as CreationDate,
      ernam as CreatedByUser,
      post1 as ProjectElementDescription,
      werks as Plant
}
