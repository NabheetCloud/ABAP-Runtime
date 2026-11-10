@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Internal Order'
@VDM.viewType: #BASIC
@ObjectModel.usageType.dataClass: #MASTER
define view entity I_InternalOrder
  as select from aufk
{
  key aufnr as InternalOrder,
      auart as OrderType,
      autyp as OrderCategory,
      kokrs as ControllingArea,
      bukrs as CompanyCode,
      werks as Plant,
      prctr as ProfitCenter,
      objnr as MaintObjectInternalID,
      erdat as CreationDate,
      ktext as InternalOrderDescription,
      ernam as CreatedByUser,
      aedat as LastChangeDate,
      waers as Currency
}
where autyp = '01'
