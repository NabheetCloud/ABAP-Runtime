@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Network'
@VDM.viewType: #BASIC
@ObjectModel.usageType.dataClass: #MASTER
define view entity I_Network
  as select from aufk
{
  key aufnr as ProjectNetwork,
      auart as NetworkType,
      autyp as OrderCategory,
      kokrs as ControllingArea,
      bukrs as CompanyCode,
      werks as Plant,
      prctr as ProfitCenter,
      objnr as MaintObjectInternalID,
      erdat as CreationDate,
      ktext as ProjectNetworkDescription,
      ernam as CreatedByUser,
      aedat as LastChangeDate,
      waers as Currency
}
where autyp = '20'
