@EndUserText.label : 'Flights'
define table zcflight_a {
  key client        : abap.clnt not null;
  key carrier_id    : abap.char(3) not null;
  key connection_id : abap.numc(4) not null;
  city_from         : abap.char(20);
  price             : abap.dec(11,2);
}
