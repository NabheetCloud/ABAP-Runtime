@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Profit Center'
@VDM.viewType: #BASIC
@ObjectModel.usageType.dataClass: #MASTER
define view entity I_ProfitCenter
  as select from cepc
  association [0..*] to I_ProfitCenterText as _Text on $projection.ControllingArea = _Text.ControllingArea and $projection.ProfitCenter = _Text.ProfitCenter and $projection.ValidityEndDate = _Text.ValidityEndDate
{
  key kokrs as ControllingArea,
  key prctr as ProfitCenter,
  key datbi as ValidityEndDate,
      datab as ValidityStartDate,
      bukrs as CompanyCode,
      verak as ProfitCtrResponsiblePersonName,
      segment as Segment,
    _Text
}
