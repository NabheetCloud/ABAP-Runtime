@EndUserText.label : 'Booking'
define table zbooking_a {
  key client            : abap.clnt not null;
  key booking_uuid      : sysuuid_x16 not null;
  parent_uuid           : sysuuid_x16;
  booking_id            : abap.numc(4);
  booking_date          : abap.dats;
  carrier_id            : abap.char(3);
  flight_date           : abap.dats;
  @Semantics.amount.currencyCode : 'zbooking_a.currency_code'
  flight_price          : abap.curr(16,2);
  currency_code         : abap.cuky;
  booking_status        : abap.char(1);
  local_last_changed_at : abp_locinst_lastchange_tstmpl;
}
