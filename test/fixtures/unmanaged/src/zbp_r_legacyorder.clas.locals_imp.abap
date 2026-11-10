" transactional buffer of the legacy application
CLASS lcl_buffer DEFINITION.
  PUBLIC SECTION.
    TYPES: BEGIN OF ty_entry,
             data TYPE zlegacy_ord,
             op   TYPE c LENGTH 1,
           END OF ty_entry.
    CLASS-DATA mt_buffer TYPE STANDARD TABLE OF ty_entry WITH EMPTY KEY.
    CLASS-DATA mt_locks TYPE STANDARD TABLE OF zlegacy_ord WITH EMPTY KEY.
    CLASS-METHODS get IMPORTING iv_order_no TYPE zlegacy_ord-order_no RETURNING VALUE(rs_order) TYPE zlegacy_ord.
ENDCLASS.

CLASS lcl_buffer IMPLEMENTATION.
  METHOD get.
    READ TABLE mt_buffer INTO DATA(ls_entry) WITH KEY data-order_no = iv_order_no.
    IF sy-subrc = 0.
      IF ls_entry-op <> 'D'.
        rs_order = ls_entry-data.
      ENDIF.
      RETURN.
    ENDIF.
    SELECT SINGLE * FROM zlegacy_ord WHERE order_no = @iv_order_no INTO @rs_order.
  ENDMETHOD.
ENDCLASS.

CLASS lhc_order DEFINITION INHERITING FROM cl_abap_behavior_handler.
  PRIVATE SECTION.
    METHODS get_instance_authorizations FOR INSTANCE AUTHORIZATION
      IMPORTING keys REQUEST requested_authorizations FOR Order RESULT result.
    METHODS create FOR MODIFY IMPORTING entities FOR CREATE Order.
    METHODS update FOR MODIFY IMPORTING entities FOR UPDATE Order.
    METHODS delete FOR MODIFY IMPORTING keys FOR DELETE Order.
    METHODS read FOR READ IMPORTING keys FOR READ Order RESULT result.
    METHODS lock FOR LOCK IMPORTING keys FOR LOCK Order.
    METHODS close FOR MODIFY IMPORTING keys FOR ACTION Order~close RESULT result.
ENDCLASS.

CLASS lhc_order IMPLEMENTATION.
  METHOD get_instance_authorizations.
  ENDMETHOD.

  METHOD create.
    SELECT MAX( order_no ) FROM zlegacy_ord INTO @DATA(lv_max).
    LOOP AT lcl_buffer=>mt_buffer INTO DATA(ls_b).
      IF ls_b-data-order_no > lv_max.
        lv_max = ls_b-data-order_no.
      ENDIF.
    ENDLOOP.
    LOOP AT entities INTO DATA(ls_entity).
      lv_max = lv_max + 1.
      DATA(ls_order) = VALUE zlegacy_ord( order_no = lv_max customer = ls_entity-Customer amount = ls_entity-Amount status = 'O' ).
      GET TIME STAMP FIELD ls_order-changed_at.
      APPEND VALUE #( data = ls_order op = 'C' ) TO lcl_buffer=>mt_buffer.
      APPEND VALUE #( %cid = ls_entity-%cid OrderNo = ls_order-order_no ) TO mapped-order.
    ENDLOOP.
  ENDMETHOD.

  METHOD update.
    LOOP AT entities INTO DATA(ls_entity).
      DATA(ls_order) = lcl_buffer=>get( ls_entity-OrderNo ).
      IF ls_order IS INITIAL.
        APPEND VALUE #( OrderNo = ls_entity-OrderNo %fail-cause = if_abap_behv=>cause-not_found ) TO failed-order.
        CONTINUE.
      ENDIF.
      IF ls_entity-%control-Customer = if_abap_behv=>mk-on.
        ls_order-customer = ls_entity-Customer.
      ENDIF.
      IF ls_entity-%control-Amount = if_abap_behv=>mk-on.
        ls_order-amount = ls_entity-Amount.
      ENDIF.
      GET TIME STAMP FIELD ls_order-changed_at.
      DELETE lcl_buffer=>mt_buffer WHERE data-order_no = ls_order-order_no.
      APPEND VALUE #( data = ls_order op = 'U' ) TO lcl_buffer=>mt_buffer.
    ENDLOOP.
  ENDMETHOD.

  METHOD delete.
    LOOP AT keys INTO DATA(ls_key).
      DATA(ls_order) = lcl_buffer=>get( ls_key-OrderNo ).
      DELETE lcl_buffer=>mt_buffer WHERE data-order_no = ls_key-OrderNo.
      APPEND VALUE #( data = ls_order op = 'D' ) TO lcl_buffer=>mt_buffer.
    ENDLOOP.
  ENDMETHOD.

  METHOD read.
    LOOP AT keys INTO DATA(ls_key).
      DATA(ls_order) = lcl_buffer=>get( ls_key-OrderNo ).
      IF ls_order IS NOT INITIAL.
        APPEND VALUE #( OrderNo = ls_order-order_no Customer = ls_order-customer Amount = ls_order-amount
                        Status = ls_order-status ChangedAt = ls_order-changed_at ) TO result.
      ELSE.
        APPEND VALUE #( OrderNo = ls_key-OrderNo %fail-cause = if_abap_behv=>cause-not_found ) TO failed-order.
      ENDIF.
    ENDLOOP.
  ENDMETHOD.

  METHOD lock.
    LOOP AT keys INTO DATA(ls_key).
      IF ls_key-OrderNo = '00000099'.
        APPEND VALUE #( OrderNo = ls_key-OrderNo %fail-cause = if_abap_behv=>cause-locked ) TO failed-order.
        APPEND VALUE #( OrderNo = ls_key-OrderNo %msg = new_message_with_text( text = 'Order 99 is locked in the legacy system' ) ) TO reported-order.
      ENDIF.
    ENDLOOP.
  ENDMETHOD.

  METHOD close.
    MODIFY ENTITIES OF zr_legacyorder IN LOCAL MODE
      ENTITY Order UPDATE FIELDS ( Amount ) WITH VALUE #( FOR k IN keys ( OrderNo = k-OrderNo Amount = 0 ) ).
    LOOP AT keys INTO DATA(ls_key).
      DATA(ls_order) = lcl_buffer=>get( ls_key-OrderNo ).
      ls_order-status = 'C'.
      DELETE lcl_buffer=>mt_buffer WHERE data-order_no = ls_order-order_no.
      APPEND VALUE #( data = ls_order op = 'U' ) TO lcl_buffer=>mt_buffer.
    ENDLOOP.
    READ ENTITIES OF zr_legacyorder IN LOCAL MODE ENTITY Order ALL FIELDS WITH CORRESPONDING #( keys ) RESULT DATA(lt_orders).
    result = VALUE #( FOR o IN lt_orders ( OrderNo = o-OrderNo %param = o ) ).
  ENDMETHOD.
ENDCLASS.

CLASS lsc_order DEFINITION INHERITING FROM cl_abap_behavior_saver.
  PROTECTED SECTION.
    METHODS check_before_save REDEFINITION.
    METHODS save REDEFINITION.
    METHODS cleanup REDEFINITION.
ENDCLASS.

CLASS lsc_order IMPLEMENTATION.
  METHOD check_before_save.
    LOOP AT lcl_buffer=>mt_buffer INTO DATA(ls_entry) WHERE op <> 'D'.
      IF ls_entry-data-customer IS INITIAL.
        APPEND VALUE #( OrderNo = ls_entry-data-order_no %fail-cause = if_abap_behv=>cause-unspecific ) TO failed-order.
        APPEND VALUE #( OrderNo = ls_entry-data-order_no %msg = new_message_with_text( text = 'Customer is required' ) ) TO reported-order.
      ENDIF.
    ENDLOOP.
  ENDMETHOD.

  METHOD save.
    LOOP AT lcl_buffer=>mt_buffer INTO DATA(ls_entry).
      CASE ls_entry-op.
        WHEN 'C'.
          INSERT zlegacy_ord FROM @ls_entry-data.
        WHEN 'U'.
          UPDATE zlegacy_ord FROM @ls_entry-data.
          IF ls_entry-data-status = 'C'.
            RAISE ENTITY EVENT zr_legacyorder~Closed FROM VALUE #( ( OrderNo = ls_entry-data-order_no ) ).
          ENDIF.
        WHEN 'D'.
          DELETE zlegacy_ord FROM @ls_entry-data.
      ENDCASE.
    ENDLOOP.
  ENDMETHOD.

  METHOD cleanup.
    CLEAR lcl_buffer=>mt_buffer.
  ENDMETHOD.
ENDCLASS.
