REPORT zcflight_batch.

* Checks the flight prices into an application log (object ZCFL, subobject PRICES) and schedules the
* report ZCFLIGHT_REPORT as background job ZCFL_PRICES.

PARAMETERS p_max TYPE i DEFAULT 620.

START-OF-SELECTION.
  DATA lv_jobcount TYPE btcjobcnt.

  TRY.
      DATA(lo_log) = cl_bali_log=>create_with_header(
        cl_bali_header_setter=>create( object = 'ZCFL' subobject = 'PRICES' external_id = 'Price check' ) ).
      SELECT * FROM zcflight_a ORDER BY carrier_id, connection_id INTO TABLE @DATA(lt_flights).
      LOOP AT lt_flights INTO DATA(ls_flight).
        IF ls_flight-price > p_max.
          lo_log->add_item( cl_bali_free_text_setter=>create(
            severity = if_bali_constants=>c_severity_warning
            text     = |{ ls_flight-carrier_id } { ls_flight-connection_id } costs { ls_flight-price }, more than { p_max }| ) ).
        ELSE.
          lo_log->add_item( cl_bali_free_text_setter=>create(
            severity = if_bali_constants=>c_severity_status
            text     = |{ ls_flight-carrier_id } { ls_flight-connection_id } is fine| ) ).
        ENDIF.
      ENDLOOP.
      cl_bali_log_db=>get_instance( )->save_log( log = lo_log ).
      WRITE: / 'Log saved with', lines( lt_flights ), 'messages'.
    CATCH cx_bali_runtime INTO DATA(lx_log).
      WRITE: / 'Log failed:', lx_log->get_text( ).
  ENDTRY.

  CALL FUNCTION 'JOB_OPEN'
    EXPORTING
      jobname  = 'ZCFL_PRICES'
    IMPORTING
      jobcount = lv_jobcount
    EXCEPTIONS
      OTHERS   = 1.
  IF sy-subrc = 0.
    CALL FUNCTION 'JOB_SUBMIT'
      EXPORTING
        jobcount = lv_jobcount
        jobname  = 'ZCFL_PRICES'
        report   = 'ZCFLIGHT_REPORT'
      EXCEPTIONS
        OTHERS   = 1.
  ENDIF.
  IF sy-subrc = 0.
    CALL FUNCTION 'JOB_CLOSE'
      EXPORTING
        jobcount  = lv_jobcount
        jobname   = 'ZCFL_PRICES'
        strtimmed = 'X'
      EXCEPTIONS
        OTHERS    = 1.
  ENDIF.
  IF sy-subrc = 0.
    WRITE: / 'Job ZCFL_PRICES', lv_jobcount, 'released'.
  ELSE.
    WRITE: / 'Job could not be scheduled'.
  ENDIF.
