REPORT zcflight_report.

PARAMETERS p_carr TYPE c LENGTH 3 DEFAULT 'LH'.

START-OF-SELECTION.
  SELECT * FROM zcflight_a WHERE carrier_id = @p_carr ORDER BY connection_id INTO TABLE @DATA(lt_flights).
  WRITE: / 'Flights of', p_carr.
  ULINE.
  LOOP AT lt_flights INTO DATA(ls_flight).
    WRITE: / ls_flight-connection_id, ls_flight-city_from, ls_flight-price.
  ENDLOOP.
