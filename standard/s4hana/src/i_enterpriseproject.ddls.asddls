@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Enterprise Project'
@VDM.viewType: #BASIC
@ObjectModel.usageType.dataClass: #MASTER
define view entity I_EnterpriseProject
  as select from proj
{
  key pspnr as ProjectInternalID,
      pspid as Project,
      objnr as MaintObjectInternalID,
      erdat as CreationDate,
      ernam as CreatedByUser,
      post1 as ProjectDescription,
      prctr as ProfitCenter,
      waers as Currency,
      werks as Plant
}
