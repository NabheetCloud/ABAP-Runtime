"! Purchase order service
CLASS zcl_po_service DEFINITION PUBLIC FINAL CREATE PUBLIC.
PUBLIC SECTION.
INTERFACES if_oo_adt_classrun.
TYPES tt_items TYPE STANDARD TABLE OF zpo_item WITH DEFAULT KEY.
METHODS create
IMPORTING is_header TYPE zpo_s_header
it_items TYPE zpo_t_item
RETURNING VALUE(rv_ebeln) TYPE zpo_ebeln
RAISING zcx_po_error.
METHODS read
IMPORTING iv_ebeln TYPE zpo_ebeln
EXPORTING es_header TYPE zpo_head
et_items TYPE tt_items
RAISING zcx_po_error.
METHODS release
IMPORTING iv_ebeln TYPE zpo_ebeln
RAISING zcx_po_error.
ENDCLASS.

CLASS zcl_po_service IMPLEMENTATION.
METHOD create.
DATA lt_items TYPE STANDARD TABLE OF zpo_s_item.
lt_items = it_items.
CALL FUNCTION 'ZPO_CREATE'
EXPORTING
is_header = is_header
IMPORTING
ev_ebeln = rv_ebeln
TABLES
it_items = lt_items
EXCEPTIONS
no_items = 1
locked = 2
already_exists = 3
OTHERS = 4.
CASE sy-subrc.
WHEN 0.
WHEN 2.
RAISE EXCEPTION TYPE zcx_po_error EXPORTING textid = zcx_po_error=>locked ebeln = is_header-ebeln.
WHEN OTHERS.
RAISE EXCEPTION TYPE zcx_po_error EXPORTING textid = zcx_po_error=>not_found ebeln = is_header-ebeln.
ENDCASE.
ENDMETHOD.

METHOD read.
CALL FUNCTION 'ZPO_GET_DETAIL'
EXPORTING
iv_ebeln = iv_ebeln
IMPORTING
es_header = es_header
TABLES
et_items = et_items
EXCEPTIONS
not_found = 1
OTHERS = 2.
IF sy-subrc <> 0.
RAISE EXCEPTION TYPE zcx_po_error EXPORTING textid = zcx_po_error=>not_found ebeln = iv_ebeln.
ENDIF.
ENDMETHOD.

METHOD release.
DATA ls_head TYPE zpo_head.
SELECT SINGLE * FROM zpo_head INTO @ls_head WHERE ebeln = @iv_ebeln.
IF sy-subrc <> 0.
RAISE EXCEPTION TYPE zcx_po_error EXPORTING textid = zcx_po_error=>not_found ebeln = iv_ebeln.
ENDIF.
IF ls_head-status <> 'N' AND ls_head-status <> 'O'.
RAISE EXCEPTION TYPE zcx_po_error EXPORTING textid = zcx_po_error=>wrong_status ebeln = iv_ebeln status = ls_head-status.
ENDIF.
CALL FUNCTION 'ENQUEUE_EZPO_HEAD' EXPORTING ebeln = iv_ebeln EXCEPTIONS foreign_lock = 1 OTHERS = 2.
IF sy-subrc <> 0.
RAISE EXCEPTION TYPE zcx_po_error EXPORTING textid = zcx_po_error=>locked ebeln = iv_ebeln.
ENDIF.
UPDATE zpo_head SET status = 'R' WHERE ebeln = @iv_ebeln.
CALL FUNCTION 'DEQUEUE_EZPO_HEAD' EXPORTING ebeln = iv_ebeln.
ENDMETHOD.

METHOD if_oo_adt_classrun~main.
DATA ls_head TYPE zpo_head.
DATA lt_items TYPE tt_items.
TRY.
read( EXPORTING iv_ebeln = '4500000001' IMPORTING es_header = ls_head et_items = lt_items ).
out->write( |PO { ls_head-ebeln } vendor { ls_head-lifnr } status { ls_head-status } net { ls_head-netwr } { ls_head-waers }| ).
out->write( lt_items ).
release( '4500000001' ).
out->write( 'Released' ).
release( '4500000001' ).
CATCH zcx_po_error INTO DATA(lx).
out->write( lx->get_text( ) ).
ENDTRY.
ENDMETHOD.
ENDCLASS.