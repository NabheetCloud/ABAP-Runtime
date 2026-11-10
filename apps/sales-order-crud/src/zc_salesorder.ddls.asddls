@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Sales Order - Projection'
@Metadata.allowExtensions: true
@Search.searchable: true
define root view entity ZC_SalesOrder
  provider contract transactional_query
  as projection on ZR_SalesOrder
{
  key OrderUUID,
      @Search.defaultSearchElement: true
      OrderID,
      @Consumption.valueHelpDefinition: [{ entity: { name: 'ZI_SOCustomer', element: 'CustomerID' } }]
      @ObjectModel.text.element: ['CustomerName']
      CustomerID,
      @Search.defaultSearchElement: true
      _Customer.CustomerName as CustomerName,
      @Search.defaultSearchElement: true
      Description,
      OrderDate,
      DeliveryDate,
      GrossAmount,
      CurrencyCode,
      @ObjectModel.text.element: ['StatusText']
      OverallStatus,
      case OverallStatus
        when 'R' then 3
        when 'C' then 1
        else 2
      end                    as StatusCriticality,
      case OverallStatus
        when 'R' then 'Released'
        when 'C' then 'Cancelled'
        else 'New'
      end                    as StatusText,
      CreatedBy,
      CreatedAt,
      LastChangedBy,
      LastChangedAt,
      LocalLastChangedAt,

      _Item : redirected to composition child ZC_SalesOrderItem,
      _Customer
}
