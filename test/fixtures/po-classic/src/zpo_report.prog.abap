REPORT zpo_report.

* Purchase order list: creates a sample PO with ZPO_CREATE (optional), reads POs with ZPO_GET_DETAIL

TABLES zpo_head.

SELECTION-SCREEN BEGIN OF BLOCK b1 WITH FRAME TITLE TEXT-001.
  SELECT-OPTIONS s_ebeln FOR zpo_head-ebeln.
  SELECT-OPTIONS s_lifnr FOR zpo_head-lifnr.
  PARAMETERS p_stat TYPE zpo_stat.
SELECTION-SCREEN END OF BLOCK b1.
SELECTION-SCREEN BEGIN OF BLOCK b2 WITH FRAME TITLE TEXT-002.
  PARAMETERS p_create AS CHECKBOX DEFAULT ' '.
  PARAMETERS p_newpo TYPE zpo_ebeln DEFAULT '4500000001'.
  PARAMETERS p_alv AS CHECKBOX DEFAULT 'X'.
  PARAMETERS p_rel AS CHECKBOX DEFAULT ' '.
SELECTION-SCREEN END OF BLOCK b2.

DATA gt_heads TYPE STANDARD TABLE OF zpo_head WITH DEFAULT KEY.
DATA gt_items TYPE STANDARD TABLE OF zpo_item WITH DEFAULT KEY.

INITIALIZATION.
  p_stat = space.

AT SELECTION-SCREEN.
  IF p_create = abap_true AND p_newpo IS INITIAL.
    MESSAGE 'Enter the number of the new purchase order' TYPE 'E'.
  ENDIF.

START-OF-SELECTION.
  IF p_create = abap_true.
    PERFORM create_sample.
  ENDIF.
  IF p_rel = abap_true.
    PERFORM release_with_class.
  ENDIF.

  SELECT * FROM zpo_head
    WHERE ebeln IN @s_ebeln
      AND lifnr IN @s_lifnr
    ORDER BY ebeln
    INTO TABLE @gt_heads.
  IF p_stat IS NOT INITIAL.
    DELETE gt_heads WHERE status <> p_stat.
  ENDIF.

END-OF-SELECTION.
  IF gt_heads IS INITIAL.
    WRITE: / 'No purchase orders found.'.
    RETURN.
  ENDIF.
  IF p_alv = abap_true.
    PERFORM show_alv.
  ELSE.
    PERFORM show_list.
  ENDIF.

FORM create_sample.
  DATA ls_head TYPE zpo_head.
  DATA lt_items TYPE STANDARD TABLE OF zpo_item WITH DEFAULT KEY.
  DATA lv_ebeln TYPE zpo_ebeln.
  ls_head-ebeln = p_newpo.
  ls_head-lifnr = 'V100'.
  ls_head-waers = 'EUR'.
  APPEND VALUE #( matnr = 'MAT-1' txz01 = 'Laptop' menge = 2 meins = 'PC' netpr = '900.00' waers = 'EUR' ) TO lt_items.
  APPEND VALUE #( matnr = 'MAT-2' txz01 = 'Docking station' menge = 2 meins = 'PC' netpr = '150.00' waers = 'EUR' ) TO lt_items.
  CALL FUNCTION 'ZPO_CREATE'
    EXPORTING
      is_header      = ls_head
    IMPORTING
      ev_ebeln       = lv_ebeln
    TABLES
      it_items       = lt_items
    EXCEPTIONS
      foreign_lock   = 1
      already_exists = 2
      no_items       = 3
      OTHERS         = 4.
  CASE sy-subrc.
    WHEN 0.
      WRITE: / 'Created purchase order', lv_ebeln.
    WHEN 1.
      WRITE: / 'Purchase order is locked by another user'.
    WHEN 2.
      WRITE: / 'Purchase order', p_newpo, 'already exists'.
    WHEN OTHERS.
      WRITE: / 'ZPO_CREATE failed, sy-subrc', sy-subrc.
  ENDCASE.
  ULINE.
ENDFORM.

FORM show_list.
  DATA ls_head TYPE zpo_head.
  DATA ls_item TYPE zpo_item.
  DATA lv_count TYPE i.
  LOOP AT gt_heads INTO ls_head.
    CALL FUNCTION 'ZPO_GET_DETAIL'
      EXPORTING
        iv_ebeln      = ls_head-ebeln
      IMPORTING
        ev_item_count = lv_count
      TABLES
        et_items      = gt_items
      EXCEPTIONS
        not_found     = 1
        OTHERS        = 2.
    WRITE: / ls_head-ebeln, ls_head-lifnr, ls_head-bedat, ls_head-status, ls_head-netwr, ls_head-waers, lv_count.
    LOOP AT gt_items INTO ls_item.
      WRITE: /5 ls_item-ebelp, ls_item-matnr, ls_item-txz01, ls_item-menge, ls_item-meins, ls_item-netpr.
    ENDLOOP.
  ENDLOOP.
ENDFORM.

FORM show_alv.
  TRY.
      cl_salv_table=>factory( IMPORTING r_salv_table = DATA(lo_alv) CHANGING t_table = gt_heads ).
      lo_alv->get_functions( )->set_all( abap_true ).
      lo_alv->get_display_settings( )->set_list_header( |Purchase orders: { lines( gt_heads ) }| ).
      lo_alv->display( ).
    CATCH cx_salv_msg INTO DATA(lx_salv).
      MESSAGE lx_salv TYPE 'E'.
  ENDTRY.
ENDFORM.

FORM release_with_class.
  DATA lo_service TYPE REF TO zcl_po_service.
  DATA ls_po TYPE zpo_s_po.
  DATA lv_items TYPE i.
  DATA lx_po TYPE REF TO zcx_po_error.
  lo_service = NEW #( ).
  TRY.
      lo_service->release( p_newpo ).
      ls_po = lo_service->read( p_newpo ).
      lv_items = lines( ls_po-items ).
      WRITE: / 'Released', ls_po-ebeln, 'status', ls_po-status, 'items', lv_items.
    CATCH zcx_po_error INTO lx_po.
      WRITE: / 'Error:', lx_po->mv_text.
  ENDTRY.
  ULINE.
ENDFORM.
