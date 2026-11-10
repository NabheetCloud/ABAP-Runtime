PROGRAM zpo_maint.

* Maintain purchase order (transaction ZPO1): header fields, items in table control TC_ITEMS,
* GUI status MAIN (Read F8, Save F11, Release F13), lock EZPO_HEAD, ZCL_PO_SERVICE.

TABLES zpo_head.
CONTROLS tc_items TYPE TABLEVIEW USING SCREEN 0100.

DATA gv_ok_code TYPE sy-ucomm.
DATA gs_head TYPE zpo_head.
DATA gs_item TYPE zpo_item.
DATA gt_items TYPE STANDARD TABLE OF zpo_item WITH DEFAULT KEY.
DATA gv_locked TYPE abap_bool.

MODULE status_0100 OUTPUT.
  SET PF-STATUS 'MAIN'.
  SET TITLEBAR 'MAIN'.
  IF lines( gt_items ) < 5.
    DO 5 - lines( gt_items ) TIMES.
      APPEND INITIAL LINE TO gt_items.
    ENDDO.
  ENDIF.
  tc_items-lines = lines( gt_items ).
ENDMODULE.

MODULE exit_0100 INPUT.
  IF gv_locked = abap_true.
    CALL FUNCTION 'DEQUEUE_EZPO_HEAD'
      EXPORTING
        ebeln = gs_head-ebeln.
  ENDIF.
  CLEAR gv_ok_code.
  LEAVE TO SCREEN 0.
ENDMODULE.

MODULE modify_item INPUT.
  MODIFY gt_items FROM gs_item INDEX tc_items-current_line.
ENDMODULE.

MODULE check_vendor INPUT.
  IF gs_head-lifnr IS INITIAL.
    MESSAGE 'Enter a vendor' TYPE 'E'.
  ENDIF.
ENDMODULE.

MODULE user_command_0100 INPUT.
  DATA lo_service TYPE REF TO zcl_po_service.
  DATA ls_po TYPE zpo_s_po.
  DATA lx_po TYPE REF TO zcx_po_error.
  DATA lv_count TYPE i.
  lo_service = NEW #( ).
  CASE gv_ok_code.
    WHEN 'SHOW'.
      TRY.
          ls_po = lo_service->read( gs_head-ebeln ).
          gs_head = CORRESPONDING #( ls_po ).
          SELECT * FROM zpo_item WHERE ebeln = @gs_head-ebeln ORDER BY ebelp INTO TABLE @gt_items.
          CALL FUNCTION 'ENQUEUE_EZPO_HEAD'
            EXPORTING
              ebeln        = gs_head-ebeln
            EXCEPTIONS
              foreign_lock = 1
              OTHERS       = 2.
          IF sy-subrc = 0.
            gv_locked = abap_true.
            MESSAGE |Purchase order { gs_head-ebeln } read and locked| TYPE 'S'.
          ELSE.
            MESSAGE |Purchase order { gs_head-ebeln } is locked by { sy-msgv1 }| TYPE 'W'.
          ENDIF.
        CATCH zcx_po_error.
          MESSAGE |Purchase order { gs_head-ebeln } does not exist: enter items and save| TYPE 'S'.
          CLEAR gt_items.
      ENDTRY.
    WHEN 'SAVE'.
      DELETE gt_items WHERE matnr IS INITIAL.
      lv_count = lines( gt_items ).
      IF lv_count = 0.
        MESSAGE 'Enter at least one item' TYPE 'E'.
      ENDIF.
      CALL FUNCTION 'ZPO_CREATE'
        EXPORTING
          is_header      = gs_head
        TABLES
          it_items       = gt_items
        EXCEPTIONS
          foreign_lock   = 1
          already_exists = 2
          no_items       = 3
          OTHERS         = 4.
      CASE sy-subrc.
        WHEN 0.
          MESSAGE |Purchase order { gs_head-ebeln } saved with { lv_count } item(s)| TYPE 'S'.
        WHEN 2.
          MESSAGE |Purchase order { gs_head-ebeln } already exists| TYPE 'I'.
        WHEN OTHERS.
          MESSAGE |Purchase order { gs_head-ebeln } could not be saved ({ sy-subrc })| TYPE 'I'.
      ENDCASE.
      TRY.
          ls_po = lo_service->read( gs_head-ebeln ).
          gs_head = CORRESPONDING #( ls_po ).
        CATCH zcx_po_error.
      ENDTRY.
    WHEN 'RELEASE'.
      TRY.
          lo_service->release( gs_head-ebeln ).
          gs_head-status = 'R'.
          MESSAGE |Purchase order { gs_head-ebeln } released| TYPE 'S'.
        CATCH zcx_po_error INTO lx_po.
          MESSAGE lx_po->mv_text TYPE 'I'.
      ENDTRY.
  ENDCASE.
  CLEAR gv_ok_code.
ENDMODULE.
