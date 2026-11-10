REPORT zcflight_print.

* Prints the print form ZCFL_FLIGHT_LIST (src/zcfl_flight_list.form.json) for one airline into the
* output queue, and shows the size of the rendered PDF.

PARAMETERS p_carr TYPE zcfl_carrier DEFAULT 'LH'.

TYPES: BEGIN OF ty_form,
         carrier      TYPE zcfl_carrier,
         carrier_name TYPE string,
         flights      TYPE zcfl_t_flights,
       END OF ty_form.

START-OF-SELECTION.
  DATA ls_form TYPE ty_form.

  ls_form-carrier = p_carr.
  ls_form-carrier_name = SWITCH #( p_carr WHEN 'LH' THEN `Lufthansa` WHEN 'AA' THEN `American Airlines` ELSE `` ).
  SELECT * FROM zcflight_a WHERE carrier_id = @p_carr ORDER BY connection_id INTO TABLE @ls_form-flights.

  DATA(lv_pdf) = zcl_rap_form=>render( iv_form = 'ZCFL_FLIGHT_LIST' is_data = ls_form ).
  WRITE: / 'PDF size', xstrlen( lv_pdf ), 'bytes'.
  DATA(lv_request) = zcl_rap_form=>print( iv_form = 'ZCFL_FLIGHT_LIST' is_data = ls_form iv_title = |Flights { p_carr }| ).
  IF sy-subrc = 0.
    WRITE: / 'Output request', lv_request, 'created'.
  ELSE.
    WRITE: / 'The form could not be printed'.
  ENDIF.
