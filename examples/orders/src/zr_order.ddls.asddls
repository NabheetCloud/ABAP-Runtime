@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Sales Order'
define root view entity ZR_Order
  as select from zorder_h
  composition [0..*] of ZR_OrderItem as _Item
{
  key order_id              as OrderID,
      customer              as Customer,
      order_date            as OrderDate,
      currency              as Currency,
      @Semantics.amount.currencyCode: 'Currency'
      total                 as Total,
      status                as Status,
      @Semantics.user.createdBy: true
      created_by            as CreatedBy,
      @Semantics.systemDateTime.createdAt: true
      created_at            as CreatedAt,
      @Semantics.user.lastChangedBy: true
      last_changed_by       as LastChangedBy,
      @Semantics.systemDateTime.lastChangedAt: true
      last_changed_at       as LastChangedAt,
      @Semantics.systemDateTime.localInstanceLastChangedAt: true
      local_last_changed_at as LocalLastChangedAt,
      _Item
}
