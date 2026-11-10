@EndUserText.label : 'Flights'
define table zflight_a {
  key client        : abap.clnt not null;
  key carrier_id    : abap.char(3) not null;
  key connection_id : abap.numc(4) not null;
  city_from         : abap.char(40);
  price             : abap.dec(11,2);
}
