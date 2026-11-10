@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Travel Analytics'
@UI.headerInfo: { typeName: 'Travel', typeNamePlural: 'Travel Analytics', title: { value: 'TravelID' } }
@UI.chart: [ { qualifier: 'ByCustomer', title: 'Total price by customer', chartType: #COLUMN,
               dimensions: [ 'CustomerName' ], measures: [ 'TotalPrice' ] } ]
@UI.presentationVariant: [ { sortOrder: [ { by: 'TotalPrice', direction: #DESC } ] } ]
define view entity ZC_TravelAnalytics
  as select from ZR_Travel
{
      @UI.lineItem: [ { position: 10 } ]
      @UI.selectionField: [ { position: 10 } ]
  key TravelID,
      @UI.lineItem: [ { position: 20 } ]
      @UI.selectionField: [ { position: 20 } ]
      _Customer.CustomerName as CustomerName,
      @UI.lineItem: [ { position: 30 } ]
      @UI.selectionField: [ { position: 30 } ]
      OverallStatus,
      @UI.lineItem: [ { position: 40 } ]
      @UI.selectionField: [ { position: 40 } ]
      CurrencyCode,
      @UI.lineItem: [ { position: 50 } ]
      BeginDate,
      @UI.lineItem: [ { position: 60 } ]
      @Aggregation.default: #SUM
      @Semantics.amount.currencyCode: 'CurrencyCode'
      TotalPrice,
      @Aggregation.default: #SUM
      @Semantics.amount.currencyCode: 'CurrencyCode'
      BookingFee
}
