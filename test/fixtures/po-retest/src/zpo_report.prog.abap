REPORT zpo_report.

TABLES zpo_head.

SELECTION-SCREEN BEGIN OF BLOCK b1 WITH FRAME TITLE TEXT-001.
  SELECT-OPTIONS s_ebeln FOR zpo_head-ebeln.
  SELECT-OPTIONS s_lifnr FOR zpo_head-lifnr.
  PARAMETERS p_stat TYPE zpo_stat.
SELECTION-SCREEN END OF BLOCK b1.
SELECTION-SCREEN BEGIN OF BLOCK b2 WITH FRAME TITLE TEXT-002.
  PARAMETERS p_alv AS CHECKBOX DEFAULT 'X'.
  PARAMETERS p_rel TYPE zpo_ebeln.
SELECTION-SCREEN END OF BLOCK b2.

DATA gt_head TYPE STANDARD TABLE OF zpo_head WITH DEFAULT KEY.

START-OF-SELECTION.
  IF p_rel IS NOT INITIAL.
    PERFORM release USING p_rel.
  ENDIF.
  SELECT * FROM zpo_head
    INTO TABLE @gt_head
    WHERE ebeln IN @s_ebeln AND lifnr IN @s_lifnr
    ORDER BY ebeln.
  IF p_stat IS NOT INITIAL.
    DELETE gt_head WHERE status <> p_stat.
  ENDIF.
  IF p_alv = abap_true.
    PERFORM show_alv.
  ELSE.
    PERFORM show_list.
  ENDIF.

FORM release USING iv_ebeln TYPE zpo_ebeln.
  DATA(lo_srv) = NEW zcl_po_service( ).
  TRY.
      lo_srv->release( iv_ebeln ).
      MESSAGE s004(zpo) WITH iv_ebeln.
    CATCH zcx_po_error INTO DATA(lx).
      MESSAGE lx->get_text( ) TYPE 'I'.
  ENDTRY.
ENDFORM.

FORM show_list.
  " TODO: variable is assigned but never used (ABAP cleaner)
  DATA ls_detail TYPE zpo_head.
  DATA lt_items  TYPE STANDARD TABLE OF zpo_item.
  DATA ls_item   TYPE zpo_item.

  LOOP AT gt_head INTO DATA(ls_head).
    CASE ls_head-status.
      WHEN 'N'.
        FORMAT COLOR COL_NORMAL.
      WHEN 'R'.
        FORMAT COLOR COL_POSITIVE.
      WHEN OTHERS.
        FORMAT RESET.
    ENDCASE.
    WRITE: / ls_head-ebeln, ls_head-lifnr, ls_head-bedat, ls_head-netwr CURRENCY ls_head-waers, ls_head-waers, ls_head-status.
    CALL FUNCTION 'ZPO_GET_DETAIL'
      EXPORTING  iv_ebeln  = ls_head-ebeln
      IMPORTING  es_header = ls_detail
      TABLES     et_items  = lt_items
      EXCEPTIONS not_found = 1
                 OTHERS    = 2.
    LOOP AT lt_items INTO ls_item.
      WRITE: /5 ls_item-ebelp, ls_item-matnr, ls_item-menge UNIT ls_item-meins, ls_item-meins, ls_item-netpr CURRENCY ls_item-waers.
    ENDLOOP.
  ENDLOOP.
  FORMAT RESET.
  ULINE.
  WRITE: / TEXT-003, lines( gt_head ).
ENDFORM.

FORM show_alv.
  DATA lo_alv TYPE REF TO cl_salv_table.

  TRY.
      cl_salv_table=>factory( IMPORTING r_salv_table = lo_alv
                              CHANGING  t_table      = gt_head ).
      lo_alv->get_functions( )->set_all( abap_true ).
      lo_alv->display( ).
    CATCH cx_salv_msg.
      WRITE / 'ALV error'.
  ENDTRY.
ENDFORM.
