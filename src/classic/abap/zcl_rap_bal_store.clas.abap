* Application logs (cl_bali_log / if_bali_log_db) saved to the app's database, so they outlive the session and
* RAP Studio can list them; open-abap-bal itself keeps saved logs in memory only.
CLASS zcl_rap_bal_store DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-METHODS save
      IMPORTING
        log TYPE REF TO if_bali_log.
  PRIVATE SECTION.
    TYPES: BEGIN OF ty_key,
             handle TYPE if_bali_log=>ty_handle,
             key    TYPE zrap_balhdr-log_handle,
           END OF ty_key.
    " open-abap numbers logs per engine process: each log gets a key of its own in the database
    CLASS-DATA gt_keys TYPE HASHED TABLE OF ty_key WITH UNIQUE KEY handle.
ENDCLASS.

CLASS zcl_rap_bal_store IMPLEMENTATION.
  METHOD save.
    DATA ls_hdr TYPE zrap_balhdr.
    DATA ls_msg TYPE zrap_balmsg.
    DATA lo_header TYPE REF TO if_bali_header_getter.
    DATA lv_ts TYPE timestamp.

    TRY.
        lo_header = log->get_header( ).
      CATCH cx_bali_runtime.
        RETURN.
    ENDTRY.
    GET TIME STAMP FIELD lv_ts.
    DATA(lv_handle) = log->get_handle( ).
    READ TABLE gt_keys INTO DATA(ls_key) WITH TABLE KEY handle = lv_handle.
    IF sy-subrc <> 0.
      ls_key-handle = lv_handle.
      ls_key-key = condense( |{ lv_ts }{ lv_handle }| ).
      INSERT ls_key INTO TABLE gt_keys.
    ENDIF.
    ls_hdr-log_handle = ls_key-key.
    ls_hdr-object = lo_header->object.
    ls_hdr-subobject = lo_header->subobject.
    ls_hdr-external_id = lo_header->external_id.
    ls_hdr-log_user = sy-uname.
    ls_hdr-program = COND #( WHEN sy-cprog <> 'OPEN_ABAP_TODO' THEN sy-cprog ).
    ls_hdr-created_at = condense( |{ lv_ts }| ).
    DELETE FROM zrap_balmsg WHERE log_handle = @ls_hdr-log_handle.
    LOOP AT log->get_all_items( ) INTO DATA(ls_item).
      CLEAR ls_msg.
      ls_msg-log_handle = ls_hdr-log_handle.
      ls_msg-item_no = ls_item-log_item_number.
      ls_msg-severity = ls_item-item->severity.
      TRY.
          ls_msg-message = ls_item-item->get_message_text( ).
        CATCH cx_bali_runtime.
          CLEAR ls_msg-message.
      ENDTRY.
      INSERT zrap_balmsg FROM @ls_msg.
      ls_hdr-msg_count = ls_hdr-msg_count + 1.
      IF ls_msg-severity CA 'EAX'.
        ls_hdr-errors = ls_hdr-errors + 1.
      ELSEIF ls_msg-severity = 'W'.
        ls_hdr-warnings = ls_hdr-warnings + 1.
      ENDIF.
    ENDLOOP.
    MODIFY zrap_balhdr FROM @ls_hdr.
  ENDMETHOD.
ENDCLASS.
