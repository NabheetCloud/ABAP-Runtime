PROGRAM zpo_maint.

* Transaction ZPO1
* Screen 0100: header and items
" Maintain purchase orders: header fields, item table control, Save/Read
DATA gv_ok_code TYPE sy-ucomm.
DATA gs_head    TYPE zpo_s_header.
DATA gt_items   TYPE STANDARD TABLE OF zpo_s_item.
DATA gs_item    TYPE zpo_s_item.
DATA gv_locked  TYPE abap_bool.
CONTROLS tc_items TYPE TABLEVIEW USING SCREEN 0100.

MODULE status_0100 OUTPUT.
  SET PF-STATUS 'MAIN'.
  SET TITLEBAR 'MAIN'.
  tc_items-lines = lines( gt_items ) + 5.
ENDMODULE.

MODULE exit_0100 INPUT.
  PERFORM leave.
ENDMODULE.

MODULE check_vendor INPUT.
  IF gs_head-lifnr IS INITIAL.
    MESSAGE 'Enter a vendor' TYPE 'E'.
  ENDIF.
ENDMODULE.

MODULE modify_item INPUT.
  MODIFY gt_items FROM gs_item INDEX tc_items-current_line.
  IF sy-subrc <> 0 AND gs_item-matnr IS NOT INITIAL.
    APPEND gs_item TO gt_items.
  ENDIF.
ENDMODULE.

MODULE user_command_0100 INPUT.
  CASE gv_ok_code.
    WHEN 'READ'.
      PERFORM read_po.
    WHEN 'SAVE'.
      PERFORM save_po.
    WHEN 'BACK'.
      PERFORM leave.
  ENDCASE.
  CLEAR gv_ok_code.
ENDMODULE.

FORM read_po.
  DATA ls_head TYPE zpo_head.
  DATA lt_db   TYPE STANDARD TABLE OF zpo_item.
  DATA ls_db   TYPE zpo_item.

  CALL FUNCTION 'ZPO_GET_DETAIL'
    EXPORTING  iv_ebeln  = gs_head-ebeln
    IMPORTING  es_header = ls_head
    TABLES     et_items  = lt_db
    EXCEPTIONS not_found = 1
               OTHERS    = 2.
  IF sy-subrc <> 0.
    MESSAGE e002(zpo) WITH gs_head-ebeln.
  ENDIF.
  CALL FUNCTION 'ENQUEUE_EZPO_HEAD'
    EXPORTING  ebeln        = gs_head-ebeln
    EXCEPTIONS foreign_lock = 1
               OTHERS       = 2.
  IF sy-subrc <> 0.
    MESSAGE s003(zpo) WITH gs_head-ebeln DISPLAY LIKE 'E'.
  ELSE.
    gv_locked = abap_true.
  ENDIF.
  MOVE-CORRESPONDING ls_head TO gs_head.
  CLEAR gt_items.
  LOOP AT lt_db INTO ls_db.
    MOVE-CORRESPONDING ls_db TO gs_item.
    APPEND gs_item TO gt_items.
  ENDLOOP.
ENDFORM.

FORM save_po.
  DATA lo_srv   TYPE REF TO zcl_po_service.
  DATA lx       TYPE REF TO zcx_po_error.
  DATA lv_ebeln TYPE zpo_ebeln.

  lo_srv = NEW #( ).
  TRY.
      lv_ebeln = lo_srv->create( is_header = gs_head
                                 it_items  = gt_items ).
      MESSAGE s001(zpo) WITH lv_ebeln.
    CATCH zcx_po_error INTO lx.
      MESSAGE lx->get_text( ) TYPE 'S' DISPLAY LIKE 'E'.
  ENDTRY.
ENDFORM.

FORM leave.
  IF gv_locked = abap_true.
    CALL FUNCTION 'DEQUEUE_EZPO_HEAD'
      EXPORTING ebeln = gs_head-ebeln.
  ENDIF.
  LEAVE TO SCREEN 0.
ENDFORM.

* table control TC_ITEMS: the changed row back into gt_items
MODULE modify_tc_items INPUT.
  MODIFY gt_items FROM gs_item INDEX tc_items-current_line.
ENDMODULE.
