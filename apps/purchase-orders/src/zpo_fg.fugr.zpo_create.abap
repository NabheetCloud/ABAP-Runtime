FUNCTION zpo_create.   " Create a purchase order
*"----------------------------------------------------------------------
*"*"Local Interface:
*"  IMPORTING
*"     REFERENCE(IS_HEADER) TYPE  ZPO_S_HEADER
*"  EXPORTING
*"     VALUE(EV_EBELN) TYPE  ZPO_EBELN
*"  TABLES
*"      IT_ITEMS STRUCTURE  ZPO_S_ITEM
*"  EXCEPTIONS
*"      NO_ITEMS
*"      LOCKED
*"      ALREADY_EXISTS
*"----------------------------------------------------------------------
  DATA ls_head TYPE zpo_head.
  DATA ls_item TYPE zpo_item.

  IF it_items[] IS INITIAL.
    RAISE no_items.
  ENDIF.
  CALL FUNCTION 'ENQUEUE_EZPO_HEAD'
    EXPORTING  ebeln        = is_header-ebeln
    EXCEPTIONS foreign_lock = 1
               OTHERS       = 2.
  IF sy-subrc <> 0.
    RAISE locked.
  ENDIF.
  SELECT SINGLE ebeln FROM zpo_head INTO @DATA(lv_dummy) WHERE ebeln = @is_header-ebeln.
  IF sy-subrc = 0.
    CALL FUNCTION 'DEQUEUE_EZPO_HEAD' EXPORTING ebeln = is_header-ebeln.
    RAISE already_exists.
  ENDIF.
  MOVE-CORRESPONDING is_header TO ls_head.
  ls_head-status = 'N'.
  ls_head-ernam  = sy-uname.
  CLEAR ls_head-netwr.
  LOOP AT it_items.
    MOVE-CORRESPONDING it_items TO ls_item.
    ls_item-ebeln = is_header-ebeln.
    INSERT zpo_item FROM ls_item.
    ls_head-netwr = ls_head-netwr + it_items-menge * it_items-netpr.
  ENDLOOP.
  INSERT zpo_head FROM ls_head.
  CALL FUNCTION 'DEQUEUE_EZPO_HEAD' EXPORTING ebeln = is_header-ebeln.
  ev_ebeln = is_header-ebeln.
ENDFUNCTION.
