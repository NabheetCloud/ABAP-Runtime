@EndUserText.label: 'Revenue per carrier'
define table function ZTF_CarrierRevenue
  with parameters p_min : abap.int4
returns {
  key client     : abap.clnt;
  key carrier_id : abap.char(3);
      total      : abap.dec(15,2);
}
implemented by method zcl_flight_tf=>revenue;
