"! Purchase order service: create, read, release purchase orders
CLASS zcl_po_service DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES if_oo_adt_classrun.
    METHODS create
      IMPORTING is_header       TYPE zpo_s_header
                it_items        TYPE zpo_t_items
      RETURNING VALUE(rv_ebeln) TYPE zpo_ebeln
      RAISING   zcx_po_error.
    METHODS read
      IMPORTING iv_ebeln     TYPE zpo_ebeln
      RETURNING VALUE(rs_po) TYPE zpo_s_po
      RAISING   zcx_po_error.
    METHODS release
      IMPORTING iv_ebeln TYPE zpo_ebeln
      RAISING   zcx_po_error.
    METHODS total
      IMPORTING it_items        TYPE zpo_t_items
      RETURNING VALUE(rv_total) TYPE zpo_netwr.
ENDCLASS.

CLASS zcl_po_service IMPLEMENTATION.
  METHOD create.
    DATA ls_head TYPE zpo_head.
    DATA ls_item TYPE zpo_item.
    IF it_items IS INITIAL.
      RAISE EXCEPTION NEW zcx_po_error( ).
    ENDIF.
    SELECT SINGLE ebeln FROM zpo_head WHERE ebeln = @is_header-ebeln INTO @DATA(lv_found).
    IF sy-subrc = 0.
      RAISE EXCEPTION NEW zcx_po_error( text = |Purchase order { is_header-ebeln } already exists| ).
    ENDIF.
    ls_head = CORRESPONDING #( is_header ).
    ls_head-status = 'N'.
    IF ls_head-bedat IS INITIAL.
      ls_head-bedat = sy-datum.
    ENDIF.
    ls_head-netwr = total( it_items ).
    LOOP AT it_items INTO DATA(ls_in).
      ls_item = CORRESPONDING #( ls_in ).
      ls_item-ebeln = ls_head-ebeln.
      ls_item-ebelp = sy-tabix * 10.
      ls_item-waers = ls_head-waers.
      INSERT zpo_item FROM @ls_item.
    ENDLOOP.
    INSERT zpo_head FROM @ls_head.
    rv_ebeln = ls_head-ebeln.
  ENDMETHOD.

  METHOD read.
    SELECT SINGLE * FROM zpo_head WHERE ebeln = @iv_ebeln INTO @DATA(ls_head).
    IF sy-subrc <> 0.
      RAISE EXCEPTION NEW zcx_po_error( ).
    ENDIF.
    rs_po = CORRESPONDING #( ls_head ).
    SELECT * FROM zpo_item WHERE ebeln = @iv_ebeln ORDER BY ebelp INTO TABLE @DATA(lt_items).
    rs_po-items = CORRESPONDING #( lt_items ).
  ENDMETHOD.

  METHOD release.
    UPDATE zpo_head SET status = 'R' WHERE ebeln = @iv_ebeln.
    IF sy-subrc <> 0.
      RAISE EXCEPTION NEW zcx_po_error( ).
    ENDIF.
  ENDMETHOD.

  METHOD total.
    LOOP AT it_items INTO DATA(ls_item).
      rv_total = rv_total + ls_item-menge * ls_item-netpr.
    ENDLOOP.
  ENDMETHOD.

  METHOD if_oo_adt_classrun~main.
    DATA(lt_items) = VALUE zpo_t_items(
      ( matnr = 'MAT-9' txz01 = 'Monitor' menge = 3 meins = 'PC' netpr = '200.00' ) ).
    TRY.
        DATA(lv_ebeln) = create( is_header = VALUE #( ebeln = '4500000002' lifnr = 'V200' waers = 'EUR' )
                                 it_items  = lt_items ).
        out->write( |Created { lv_ebeln }| ).
      CATCH zcx_po_error INTO DATA(lx).
        out->write( |Create: { lx->get_text( ) }| ).
    ENDTRY.
    TRY.
        DATA(ls_po) = read( '4500000002' ).
        out->write( |PO { ls_po-ebeln } vendor { ls_po-lifnr } total { ls_po-netwr } { ls_po-waers }, { lines( ls_po-items ) } item(s)| ).
      CATCH zcx_po_error INTO lx.
        out->write( |Read: { lx->mv_text }| ).
    ENDTRY.
  ENDMETHOD.
ENDCLASS.
