@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'WBS Element'
@VDM.viewType: #BASIC
@ObjectModel.usageType.dataClass: #MASTER
define view entity I_WBSElement
  as select from prps
{
  key pspnr as WBSElementInternalID,
      posid as WBSElement,
      psphi as ProjectInternalID,
      objnr as MaintObjectInternalID,
      prctr as ProfitCenter,
      erdat as CreationDate,
      ernam as CreatedByUser,
      post1 as WBSDescription,
      werks as Plant
}
