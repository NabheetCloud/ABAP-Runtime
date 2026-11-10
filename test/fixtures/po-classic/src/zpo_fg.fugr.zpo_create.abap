FUNCTION zpo_create.
*"----------------------------------------------------------------------
*"*"Local Interface:
*"  IMPORTING
*"     VALUE(IS_HEADER) TYPE  ZPO_HEAD
*"  EXPORTING
*"     VALUE(EV_EBELN) TYPE  ZPO_EBELN
*"  TABLES
*"      IT_ITEMS STRUCTURE  ZPO_ITEM
*"  EXCEPTIONS
*"      FOREIGN_LOCK
*"      ALREADY_EXISTS
*"      NO_ITEMS
*"----------------------------------------------------------------------
  DATA ls_head TYPE zpo_head.
  DATA ls_item TYPE zpo_item.
  DATA lv_total TYPE zpo_netwr.

  IF it_items[] IS INITIAL.
    RAISE no_items.
  ENDIF.

  CALL FUNCTION 'ENQUEUE_EZPO_HEAD'
    EXPORTING
      ebeln          = is_header-ebeln
    EXCEPTIONS
      foreign_lock   = 1
      system_failure = 2
      OTHERS         = 3.
  IF sy-subrc <> 0.
    RAISE foreign_lock.
  ENDIF.

  SELECT SINGLE ebeln FROM zpo_head WHERE ebeln = @is_header-ebeln INTO @DATA(lv_exists).
  IF sy-subrc = 0.
    CALL FUNCTION 'DEQUEUE_EZPO_HEAD'
      EXPORTING
        ebeln = is_header-ebeln.
    RAISE already_exists.
  ENDIF.

  ls_head = is_header.
  ls_head-status = 'N'.
  IF ls_head-bedat IS INITIAL.
    ls_head-bedat = sy-datum.
  ENDIF.
  LOOP AT it_items INTO ls_item.
    ls_item-ebeln = ls_head-ebeln.
    ls_item-ebelp = sy-tabix * 10.
    lv_total = lv_total + ls_item-menge * ls_item-netpr.
    INSERT zpo_item FROM @ls_item.
  ENDLOOP.
  ls_head-netwr = lv_total.
  INSERT zpo_head FROM @ls_head.

  CALL FUNCTION 'DEQUEUE_EZPO_HEAD'
    EXPORTING
      ebeln = is_header-ebeln.
  ev_ebeln = ls_head-ebeln.
ENDFUNCTION.
