define view entity ZI_Flight as select from zflight_a
{
  key carrier_id    as CarrierId,
  key connection_id as ConnectionId,
      city_from     as CityFrom,
      price         as Price
}
