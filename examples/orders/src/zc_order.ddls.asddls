@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Sales Order - Projection'
@Metadata.allowExtensions: true
@Search.searchable: true
define root view entity ZC_Order
  provider contract transactional_query
  as projection on ZR_Order
{
  key OrderID,
      @Search.defaultSearchElement: true
      Customer,
      OrderDate,
      Currency,
      Total,
      Status,
      case Status when 'R' then 3 when 'N' then 2 else 0 end as StatusCriticality,
      case Status when 'R' then 'Released' when 'N' then 'New' else '' end as StatusText,
      CreatedBy,
      CreatedAt,
      LastChangedAt,
      LocalLastChangedAt,
      _Item : redirected to composition child ZC_OrderItem
}
