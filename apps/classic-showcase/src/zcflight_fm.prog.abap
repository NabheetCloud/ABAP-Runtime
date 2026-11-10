REPORT zcflight_fm.

* Calls function module Z_CFL_FLIGHTS (function group ZCFL); the airline parameter uses the
* data element ZCFL_CARRIER, whose domain has fixed values.

PARAMETERS p_carr TYPE zcfl_carrier DEFAULT 'LH'.

START-OF-SELECTION.
  DATA lt_flights TYPE zcfl_t_flights.
  DATA lv_total TYPE f.

  CALL FUNCTION 'Z_CFL_FLIGHTS'
    EXPORTING
      iv_carrier = p_carr
    IMPORTING
      et_flights = lt_flights
      ev_total   = lv_total
    EXCEPTIONS
      not_found  = 1
      OTHERS     = 2.
  IF sy-subrc <> 0.
    WRITE: / 'No flights for', p_carr.
    RETURN.
  ENDIF.

  DATA(lo_type) = CAST cl_abap_elemdescr( cl_abap_typedescr=>describe_by_name( 'ZCFL_CARRIER' ) ).
  DATA(lt_fixed) = lo_type->get_ddic_fixed_values( ).
  READ TABLE lt_fixed INTO DATA(ls_fixed) WITH KEY low = p_carr.
  WRITE: / 'Airline', p_carr, ls_fixed-ddtext.
  WRITE: / 'Flights', lines( lt_flights ).
  WRITE: / 'Total', |{ lv_total DECIMALS = 2 }|.
  " XCO (open-abap-xco): string handling of the ABAP Cloud APIs
  WRITE: / 'XCO', xco_cp=>string( |{ ls_fixed-ddtext }| )->to_upper_case( )->value.
