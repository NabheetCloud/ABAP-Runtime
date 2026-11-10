@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Travel - Projection'
@Metadata.allowExtensions: true
@Search.searchable: true
define root view entity ZC_Travel
  provider contract transactional_query
  as projection on ZR_Travel
{
  key TravelUUID,
      @Search.defaultSearchElement: true
      TravelID,
      @Consumption.valueHelpDefinition: [{ entity: { name: 'ZI_Customer', element: 'CustomerID' } }]
      @ObjectModel.text.element: ['CustomerName']
      CustomerID,
      @Search.defaultSearchElement: true
      _Customer.CustomerName as CustomerName,
      @Search.defaultSearchElement: true
      Description,
      BeginDate,
      EndDate,
      BookingFee,
      TotalPrice,
      CurrencyCode,
      OverallStatus,
      case OverallStatus
        when 'A' then 3
        when 'X' then 1
        else 2
      end                    as StatusCriticality,
      case OverallStatus
        when 'A' then 'Accepted'
        when 'X' then 'Rejected'
        else 'Open'
      end                    as StatusText,
      RejectReason,
      CreatedBy,
      CreatedAt,
      LastChangedAt,
      LocalLastChangedAt,

      _Booking : redirected to composition child ZC_Booking,
      _Customer
}
