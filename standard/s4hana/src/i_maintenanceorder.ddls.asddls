@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Maintenance Order'
@VDM.viewType: #BASIC
@ObjectModel.usageType.dataClass: #MASTER
define view entity I_MaintenanceOrder
  as select from aufk
{
  key aufnr as MaintenanceOrder,
      auart as MaintenanceOrderType,
      autyp as OrderCategory,
      kokrs as ControllingArea,
      bukrs as CompanyCode,
      werks as Plant,
      prctr as ProfitCenter,
      objnr as MaintObjectInternalID,
      erdat as CreationDate,
      ktext as MaintenanceOrderDesc,
      ernam as CreatedByUser,
      aedat as LastChangeDate,
      waers as Currency
}
where autyp = '30'
