CLASS lhc_order DEFINITION INHERITING FROM cl_abap_behavior_handler.
  PRIVATE SECTION.
    METHODS get_instance_features FOR INSTANCE FEATURES
      IMPORTING keys REQUEST requested_features FOR Order RESULT result.
    METHODS get_instance_authorizations FOR INSTANCE AUTHORIZATION
      IMPORTING keys REQUEST requested_authorizations FOR Order RESULT result.
    METHODS release FOR MODIFY
      IMPORTING keys FOR ACTION Order~release RESULT result.
    METHODS recalcTotal FOR MODIFY
      IMPORTING keys FOR ACTION Order~recalcTotal.
    METHODS setDefaults FOR DETERMINE ON MODIFY
      IMPORTING keys FOR Order~setDefaults.
    METHODS calcTotal FOR DETERMINE ON MODIFY
      IMPORTING keys FOR Order~calcTotal.
    METHODS validateCustomer FOR VALIDATE ON SAVE
      IMPORTING keys FOR Order~validateCustomer.
ENDCLASS.

CLASS lhc_order IMPLEMENTATION.

  METHOD get_instance_features.
    READ ENTITIES OF zr_order IN LOCAL MODE
      ENTITY Order FIELDS ( Status ) WITH CORRESPONDING #( keys )
      RESULT DATA(orders).
    result = VALUE #( FOR o IN orders
                      ( %tky           = o-%tky
                        %action-release = COND #( WHEN o-Status = 'R' THEN if_abap_behv=>fc-o-disabled
                                                  ELSE if_abap_behv=>fc-o-enabled ) ) ).
  ENDMETHOD.

  METHOD get_instance_authorizations.
    result = VALUE #( FOR key IN keys ( %tky = key-%tky %update = if_abap_behv=>auth-allowed ) ).
  ENDMETHOD.

  METHOD release.
    MODIFY ENTITIES OF zr_order IN LOCAL MODE
      ENTITY Order UPDATE FIELDS ( Status )
      WITH VALUE #( FOR key IN keys ( %tky = key-%tky Status = 'R' ) ).
    READ ENTITIES OF zr_order IN LOCAL MODE
      ENTITY Order ALL FIELDS WITH CORRESPONDING #( keys ) RESULT DATA(orders).
    result = VALUE #( FOR o IN orders ( %tky = o-%tky %param = o ) ).
  ENDMETHOD.

  METHOD recalcTotal.
    READ ENTITIES OF zr_order IN LOCAL MODE
      ENTITY Order BY \_Item FIELDS ( Amount ) WITH CORRESPONDING #( keys )
      RESULT DATA(items) LINK DATA(links).

    MODIFY ENTITIES OF zr_order IN LOCAL MODE
      ENTITY Order UPDATE FIELDS ( Total )
      WITH VALUE #( FOR key IN keys
                    ( %tky  = key-%tky
                      Total = REDUCE #( INIT sum = CONV decfloat34( 0 )
                                        FOR link IN links WHERE ( source-%tky = key-%tky )
                                        NEXT sum = sum + items[ %tky = link-target-%tky ]-Amount ) ) ).
  ENDMETHOD.

  METHOD setDefaults.
    READ ENTITIES OF zr_order IN LOCAL MODE
      ENTITY Order FIELDS ( Status OrderDate Currency ) WITH CORRESPONDING #( keys )
      RESULT DATA(orders).
    MODIFY ENTITIES OF zr_order IN LOCAL MODE
      ENTITY Order UPDATE FIELDS ( Status OrderDate Currency )
      WITH VALUE #( FOR o IN orders
                    ( %tky      = o-%tky
                      Status    = COND #( WHEN o-Status IS INITIAL THEN 'N' ELSE o-Status )
                      OrderDate = COND #( WHEN o-OrderDate IS INITIAL THEN cl_abap_context_info=>get_system_date( ) ELSE o-OrderDate )
                      Currency  = COND #( WHEN o-Currency IS INITIAL THEN 'EUR' ELSE o-Currency ) ) ).
  ENDMETHOD.

  METHOD calcTotal.
    MODIFY ENTITIES OF zr_order IN LOCAL MODE
      ENTITY Order EXECUTE recalcTotal FROM CORRESPONDING #( keys ).
  ENDMETHOD.

  METHOD validateCustomer.
    READ ENTITIES OF zr_order IN LOCAL MODE
      ENTITY Order FIELDS ( Customer ) WITH CORRESPONDING #( keys )
      RESULT DATA(orders).
    LOOP AT orders INTO DATA(order) WHERE Customer IS INITIAL.
      APPEND VALUE #( %tky = order-%tky ) TO failed-order.
      APPEND VALUE #( %tky              = order-%tky
                      %msg              = new_message_with_text( text = 'Customer is required' )
                      %element-Customer = if_abap_behv=>mk-on ) TO reported-order.
    ENDLOOP.
  ENDMETHOD.

ENDCLASS.

CLASS lhc_item DEFINITION INHERITING FROM cl_abap_behavior_handler.
  PRIVATE SECTION.
    METHODS calcAmount FOR DETERMINE ON MODIFY
      IMPORTING keys FOR Item~calcAmount.
    METHODS validateQuantity FOR VALIDATE ON SAVE
      IMPORTING keys FOR Item~validateQuantity.
ENDCLASS.

CLASS lhc_item IMPLEMENTATION.

  METHOD calcAmount.
    READ ENTITIES OF zr_order IN LOCAL MODE
      ENTITY Item FIELDS ( Quantity UnitPrice ) WITH CORRESPONDING #( keys )
      RESULT DATA(items)
      ENTITY Item BY \_Order FIELDS ( Currency ) WITH CORRESPONDING #( keys )
      RESULT DATA(orders)
      LINK DATA(links).

    MODIFY ENTITIES OF zr_order IN LOCAL MODE
      ENTITY Item
        UPDATE FIELDS ( Amount Currency )
        WITH VALUE #( FOR i IN items
                      ( %tky     = i-%tky
                        Amount   = i-Quantity * i-UnitPrice
                        Currency = VALUE #( orders[ %tky = links[ source-%tky = i-%tky ]-target-%tky ]-Currency OPTIONAL ) ) )
      ENTITY Order
        EXECUTE recalcTotal FROM CORRESPONDING #( orders ).
  ENDMETHOD.

  METHOD validateQuantity.
    READ ENTITIES OF zr_order IN LOCAL MODE
      ENTITY Item FIELDS ( Quantity ) WITH CORRESPONDING #( keys )
      RESULT DATA(items).
    LOOP AT items INTO DATA(item) WHERE Quantity <= 0.
      APPEND VALUE #( %tky = item-%tky ) TO failed-item.
      APPEND VALUE #( %tky              = item-%tky
                      %msg              = new_message_with_text( text = |Quantity of item { item-ItemNo ALPHA = OUT } must be positive| )
                      %element-Quantity = if_abap_behv=>mk-on ) TO reported-item.
    ENDLOOP.
  ENDMETHOD.

ENDCLASS.

" Saver: late numbering (final keys) and unmanaged save (this class writes the tables)
CLASS lsc_order DEFINITION INHERITING FROM cl_abap_behavior_saver.
  PROTECTED SECTION.
    METHODS adjust_numbers REDEFINITION.
    METHODS save_modified REDEFINITION.
ENDCLASS.

CLASS lsc_order IMPLEMENTATION.

  METHOD adjust_numbers.
    SELECT SINGLE FROM zorder_h FIELDS MAX( order_id ) INTO @DATA(max_order).
    LOOP AT mapped-order ASSIGNING FIELD-SYMBOL(<order>).
      max_order += 1.
      <order>-OrderID = max_order.
    ENDLOOP.

    " item numbers are counted per order (new orders still carry their preliminary key here)
    TYPES: BEGIN OF ty_counter,
             order_id TYPE n LENGTH 10,
             last     TYPE i,
           END OF ty_counter.
    DATA counters TYPE STANDARD TABLE OF ty_counter WITH EMPTY KEY.
    LOOP AT mapped-item ASSIGNING FIELD-SYMBOL(<item>).
      READ TABLE counters ASSIGNING FIELD-SYMBOL(<counter>) WITH KEY order_id = <item>-OrderID.
      IF sy-subrc <> 0.
        SELECT SINGLE FROM zorder_i FIELDS MAX( item_no ) WHERE order_id = @<item>-OrderID INTO @DATA(max_item).
        APPEND VALUE #( order_id = <item>-OrderID last = max_item ) TO counters ASSIGNING <counter>.
      ENDIF.
      <counter>-last += 1.
      <item>-ItemNo = <counter>-last.
    ENDLOOP.
  ENDMETHOD.

  METHOD save_modified.
    IF create-order IS NOT INITIAL.
      INSERT zorder_h FROM TABLE @( CORRESPONDING #( create-order MAPPING FROM ENTITY ) ).
    ENDIF.
    IF update-order IS NOT INITIAL.
      UPDATE zorder_h FROM TABLE @( CORRESPONDING #( update-order MAPPING FROM ENTITY USING CONTROL ) ).
    ENDIF.
    LOOP AT delete-order INTO DATA(deleted_order).
      DELETE FROM zorder_i WHERE order_id = @deleted_order-OrderID.
      DELETE FROM zorder_h WHERE order_id = @deleted_order-OrderID.
    ENDLOOP.

    IF create-item IS NOT INITIAL.
      INSERT zorder_i FROM TABLE @( CORRESPONDING #( create-item MAPPING FROM ENTITY ) ).
    ENDIF.
    IF update-item IS NOT INITIAL.
      UPDATE zorder_i FROM TABLE @( CORRESPONDING #( update-item MAPPING FROM ENTITY USING CONTROL ) ).
    ENDIF.
    IF delete-item IS NOT INITIAL.
      DELETE zorder_i FROM TABLE @( CORRESPONDING #( delete-item MAPPING FROM ENTITY ) ).
    ENDIF.
  ENDMETHOD.

ENDCLASS.
