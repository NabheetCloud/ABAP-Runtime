CLASS zcl_flight_tf DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES if_amdp_marker_hdb.
    CLASS-METHODS revenue FOR TABLE FUNCTION ztf_carrierrevenue.
    CLASS-METHODS ny_count RETURNING VALUE(rv_count) TYPE i.
    CLASS-METHODS big_carriers RETURNING VALUE(rv_count) TYPE i.
ENDCLASS.

CLASS zcl_flight_tf IMPLEMENTATION.
  METHOD revenue BY DATABASE FUNCTION FOR HDB LANGUAGE SQLSCRIPT OPTIONS READ-ONLY USING zflight_a.
    lt_all = SELECT client, carrier_id, price FROM zflight_a WHERE client = session_context('CLIENT');
    RETURN SELECT client, carrier_id, SUM(price) AS total FROM :lt_all
             GROUP BY client, carrier_id HAVING SUM(price) >= :p_min;
  ENDMETHOD.

  METHOD ny_count.
    DATA(lv_city) = 'New York'.
    SELECT COUNT(*) FROM zi_flightbycity( p_city = @lv_city ) INTO @rv_count.
  ENDMETHOD.

  METHOD big_carriers.
    SELECT COUNT(*) FROM ztf_carrierrevenue( p_min = 500 ) INTO @rv_count.
  ENDMETHOD.
ENDCLASS.
