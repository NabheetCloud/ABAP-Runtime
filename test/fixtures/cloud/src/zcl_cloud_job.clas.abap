CLASS zcl_cloud_job DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES if_apj_dt_exec_object.
    INTERFACES if_apj_rt_exec_object.
ENDCLASS.

CLASS zcl_cloud_job IMPLEMENTATION.
  METHOD if_apj_dt_exec_object~get_parameters.
    et_parameter_def = VALUE #( ( selname = 'P_TEXT' kind = 'P' datatype = 'C' length = 40 param_text = 'Text' changeable_ind = abap_true ) ).
  ENDMETHOD.

  METHOD if_apj_rt_exec_object~execute.
    DATA(text) = VALUE #( it_parameters[ selname = 'P_TEXT' ]-low OPTIONAL ).
    IF text = 'FAIL'.
      RAISE EXCEPTION TYPE cx_apj_rt_content.
    ENDIF.
    INSERT zcloud_run FROM @( VALUE #( id = cl_system_uuid=>create_uuid_c32_static( ) source = 'JOB' text = text ) ).
    DATA(log) = cl_bali_log=>create_with_header( cl_bali_header_setter=>create( object = 'ZJOB' subobject = 'IMPORT' ) ).
    log->add_item( cl_bali_free_text_setter=>create( severity = if_bali_constants=>c_severity_status text = |Imported { text }| ) ).
    cl_bali_log_db=>get_instance( )->save_log( log = log assign_to_current_appl_job = abap_true ).
  ENDMETHOD.
ENDCLASS.
