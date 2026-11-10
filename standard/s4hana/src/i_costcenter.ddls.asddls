@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Cost Center'
@VDM.viewType: #BASIC
@ObjectModel.usageType.dataClass: #MASTER
define view entity I_CostCenter
  as select from csks
  association [0..*] to I_CostCenterText as _Text on $projection.ControllingArea = _Text.ControllingArea and $projection.CostCenter = _Text.CostCenter and $projection.ValidityEndDate = _Text.ValidityEndDate
{
  key kokrs as ControllingArea,
  key kostl as CostCenter,
  key datbi as ValidityEndDate,
      datab as ValidityStartDate,
      bukrs as CompanyCode,
      prctr as ProfitCenter,
      kosar as CostCenterCategory,
      verak as CostCtrResponsiblePersonName,
      waers as CostCenterCurrency,
    _Text
}
