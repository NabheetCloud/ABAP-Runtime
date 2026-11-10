FUNCTION z_cfl_flights.
*"----------------------------------------------------------------------
*"*"Local Interface:
*"  IMPORTING
*"     VALUE(IV_CARRIER) TYPE  ZCFL_CARRIER
*"  EXPORTING
*"     REFERENCE(ET_FLIGHTS) TYPE  ZCFL_T_FLIGHTS
*"     REFERENCE(EV_TOTAL) TYPE  F
*"  EXCEPTIONS
*"      NOT_FOUND
*"----------------------------------------------------------------------
  SELECT * FROM zcflight_a WHERE carrier_id = @iv_carrier ORDER BY connection_id INTO TABLE @et_flights.
  IF sy-subrc <> 0.
    RAISE not_found.
  ENDIF.
  LOOP AT et_flights INTO DATA(ls_flight).
    ev_total = ev_total + ls_flight-price.
  ENDLOOP.
ENDFUNCTION.
