@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Purchase order header'
define root view entity ZI_PO_HEAD
  as select from zpo_head
{
  key ebeln as Ebeln,
      lifnr as Lifnr,
      bedat as Bedat,
      status as Status,
      netwr as Netwr,
      waers as Waers,
      @Semantics.user.createdBy: true
      created_by as CreatedBy,
      @Semantics.systemDateTime.createdAt: true
      created_at as CreatedAt,
      @Semantics.user.lastChangedBy: true
      last_changed_by as LastChangedBy,
      @Semantics.systemDateTime.lastChangedAt: true
      last_changed_at as LastChangedAt,
      @Semantics.systemDateTime.localInstanceLastChangedAt: true
      local_last_changed_at as LocalLastChangedAt
}
