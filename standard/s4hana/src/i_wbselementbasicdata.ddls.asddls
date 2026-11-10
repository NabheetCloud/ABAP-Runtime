@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'WBS Element Basic Data'
@VDM.viewType: #BASIC
@ObjectModel.usageType.dataClass: #MASTER
define view entity I_WBSElementBasicData
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
