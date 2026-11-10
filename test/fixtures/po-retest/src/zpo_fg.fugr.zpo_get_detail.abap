FUNCTION zpo_get_detail.
*"----------------------------------------------------------------------
*"*"Local Interface:
*"  IMPORTING
*"     REFERENCE(IV_EBELN) TYPE  ZPO_EBELN
*"  EXPORTING
*"     VALUE(ES_HEADER) TYPE  ZPO_HEAD
*"  TABLES
*"      ET_ITEMS STRUCTURE  ZPO_ITEM
*"  EXCEPTIONS
*"      NOT_FOUND
*"----------------------------------------------------------------------
SELECT SINGLE * FROM zpo_head INTO @es_header WHERE ebeln = @iv_ebeln.
IF sy-subrc <> 0.
RAISE not_found.
ENDIF.
SELECT * FROM zpo_item INTO TABLE @et_items WHERE ebeln = @iv_ebeln ORDER BY ebelp.
ENDFUNCTION.