FUNCTION zpo_get_detail.
*"----------------------------------------------------------------------
*"*"Local Interface:
*"  IMPORTING
*"     VALUE(IV_EBELN) TYPE  ZPO_EBELN
*"  EXPORTING
*"     VALUE(ES_HEADER) TYPE  ZPO_HEAD
*"     VALUE(EV_ITEM_COUNT) TYPE  I
*"  TABLES
*"      ET_ITEMS STRUCTURE  ZPO_ITEM
*"  EXCEPTIONS
*"      NOT_FOUND
*"----------------------------------------------------------------------
  CLEAR: es_header, et_items[].
  SELECT SINGLE * FROM zpo_head WHERE ebeln = @iv_ebeln INTO @es_header.
  IF sy-subrc <> 0.
    RAISE not_found.
  ENDIF.
  SELECT * FROM zpo_item WHERE ebeln = @iv_ebeln ORDER BY ebelp INTO TABLE @et_items.
  ev_item_count = lines( et_items ).
ENDFUNCTION.
