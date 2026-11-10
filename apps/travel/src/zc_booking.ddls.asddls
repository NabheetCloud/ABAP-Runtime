@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Booking - Projection'
@Metadata.allowExtensions: true
define view entity ZC_Booking
  as projection on ZR_Booking
{
  key BookingUUID,
      TravelUUID,
      BookingID,
      BookingDate,
      CarrierID,
      FlightDate,
      FlightPrice,
      CurrencyCode,
      BookingStatus,
      LocalLastChangedAt,

      _Travel : redirected to parent ZC_Travel
}
