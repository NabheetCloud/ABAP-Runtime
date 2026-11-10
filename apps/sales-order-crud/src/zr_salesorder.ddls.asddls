@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Sales Order'
define root view entity ZR_SalesOrder
  as select from zsalesorder_a
  composition [0..*] of ZR_SalesOrderItem as _Item
  association [0..1] to ZI_SOCustomer     as _Customer on $projection.CustomerID = _Customer.CustomerID
{
  key order_uuid            as OrderUUID,
      order_id              as OrderID,
      customer_id           as CustomerID,
      description           as Description,
      order_date            as OrderDate,
      delivery_date         as DeliveryDate,
      @Semantics.amount.currencyCode: 'CurrencyCode'
      gross_amount          as GrossAmount,
      currency_code         as CurrencyCode,
      overall_status        as OverallStatus,
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

      _Item,
      _Customer
}
