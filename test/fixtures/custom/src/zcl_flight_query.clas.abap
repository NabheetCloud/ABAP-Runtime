CLASS zcl_flight_query DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES if_rap_query_provider.
ENDCLASS.

CLASS zcl_flight_query IMPLEMENTATION.
  METHOD if_rap_query_provider~select.
    TYPES tt_flight TYPE STANDARD TABLE OF zce_flight WITH EMPTY KEY.
    DATA lt_result TYPE tt_flight.
    DATA(lv_where) = io_request->get_filter( )->get_as_sql_string( ).
    DATA(lv_top) = io_request->get_paging( )->get_page_size( ).
    DATA(lv_skip) = io_request->get_paging( )->get_offset( ).
    IF lv_top < 0.
      lv_top = 1000.
    ENDIF.
    DATA(lv_order) = `CarrierId, ConnectionId`.
    DATA(lt_sort) = io_request->get_sort_elements( ).
    IF lines( lt_sort ) > 0.
      lv_order = ``.
      LOOP AT lt_sort INTO DATA(ls_sort).
        IF lv_order IS NOT INITIAL.
          lv_order = lv_order && `, `.
        ENDIF.
        lv_order = lv_order && ls_sort-element_name && COND string( WHEN ls_sort-descending = abap_true THEN ` DESCENDING` ELSE ` ASCENDING` ).
      ENDLOOP.
    ENDIF.
    IF io_request->is_data_requested( ) = abap_true.
      SELECT carrierid, connectionid, cityfrom, price FROM zi_flight
        WHERE (lv_where)
        ORDER BY (lv_order)
        INTO CORRESPONDING FIELDS OF TABLE @lt_result
        UP TO @lv_top ROWS OFFSET @lv_skip.
      LOOP AT lt_result ASSIGNING FIELD-SYMBOL(<ls_flight>).
        <ls_flight>-priceclass = COND #( WHEN <ls_flight>-price > 500 THEN 'Premium' ELSE 'Economy' ).
      ENDLOOP.
      io_response->set_data( lt_result ).
    ENDIF.
    IF io_request->is_total_numb_of_rec_requested( ) = abap_true.
      SELECT COUNT(*) FROM zi_flight WHERE (lv_where) INTO @DATA(lv_count).
      io_response->set_total_number_of_records( lv_count ).
    ENDIF.
  ENDMETHOD.
ENDCLASS.
