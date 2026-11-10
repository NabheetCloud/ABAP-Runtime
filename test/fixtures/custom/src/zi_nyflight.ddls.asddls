@EndUserText.label: 'Flights from New York'
define view entity ZI_NYFlight as select from ZI_FlightByCity( p_city : 'New York' )
{
  key CarrierId,
  key ConnectionId,
      Price
}
