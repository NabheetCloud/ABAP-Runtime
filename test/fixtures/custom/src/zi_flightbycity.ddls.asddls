@EndUserText.label: 'Flights from a city'
define view entity ZI_FlightByCity
  with parameters
    p_city : abap.char(40),
    @Environment.systemField: #SYSTEM_DATE
    p_date : abap.dats
  as select from ZI_Flight
{
  key CarrierId,
  key ConnectionId,
      Price,
      $parameters.p_date as KeyDate
}
where CityFrom = $parameters.p_city
