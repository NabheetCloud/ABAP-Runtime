CLASS lhc_salesorder DEFINITION INHERITING FROM cl_abap_behavior_handler.
  PRIVATE SECTION.
    CONSTANTS:
      BEGIN OF order_status,
        new       TYPE c LENGTH 1 VALUE 'N',
        released  TYPE c LENGTH 1 VALUE 'R',
        cancelled TYPE c LENGTH 1 VALUE 'C',
      END OF order_status.

    METHODS get_instance_features FOR INSTANCE FEATURES
      IMPORTING keys REQUEST requested_features FOR SalesOrder RESULT result.
    METHODS get_instance_authorizations FOR INSTANCE AUTHORIZATION
      IMPORTING keys REQUEST requested_authorizations FOR SalesOrder RESULT result.
    METHODS releaseOrder FOR MODIFY
      IMPORTING keys FOR ACTION SalesOrder~releaseOrder RESULT result.
    METHODS cancelOrder FOR MODIFY
      IMPORTING keys FOR ACTION SalesOrder~cancelOrder RESULT result.
    METHODS recalcGrossAmount FOR MODIFY
      IMPORTING keys FOR ACTION SalesOrder~recalcGrossAmount.
    METHODS setInitialValues FOR DETERMINE ON MODIFY
      IMPORTING keys FOR SalesOrder~setInitialValues.
    METHODS calculateGross FOR DETERMINE ON MODIFY
      IMPORTING keys FOR SalesOrder~calculateGross.
    METHODS calculateOrderID FOR DETERMINE ON SAVE
      IMPORTING keys FOR SalesOrder~calculateOrderID.
    METHODS validateCustomer FOR VALIDATE ON SAVE
      IMPORTING keys FOR SalesOrder~validateCustomer.
    METHODS validateDates FOR VALIDATE ON SAVE
      IMPORTING keys FOR SalesOrder~validateDates.
ENDCLASS.

CLASS lhc_salesorder IMPLEMENTATION.

  METHOD get_instance_features.
    READ ENTITIES OF zr_salesorder IN LOCAL MODE
      ENTITY SalesOrder
        FIELDS ( OverallStatus ) WITH CORRESPONDING #( keys )
      RESULT DATA(orders)
      FAILED failed.

    result = VALUE #( FOR order IN orders
                      ( %tky                 = order-%tky
                        %update              = COND #( WHEN order-OverallStatus = order_status-new
                                                       THEN if_abap_behv=>fc-o-enabled ELSE if_abap_behv=>fc-o-disabled )
                        %delete              = COND #( WHEN order-OverallStatus = order_status-released
                                                       THEN if_abap_behv=>fc-o-disabled ELSE if_abap_behv=>fc-o-enabled )
                        %action-releaseOrder = COND #( WHEN order-OverallStatus = order_status-new
                                                       THEN if_abap_behv=>fc-o-enabled ELSE if_abap_behv=>fc-o-disabled )
                        %action-cancelOrder  = COND #( WHEN order-OverallStatus = order_status-cancelled
                                                       THEN if_abap_behv=>fc-o-disabled ELSE if_abap_behv=>fc-o-enabled )
                        %assoc-_Item         = COND #( WHEN order-OverallStatus = order_status-new
                                                       THEN if_abap_behv=>fc-o-enabled ELSE if_abap_behv=>fc-o-disabled ) ) ).
  ENDMETHOD.

  METHOD get_instance_authorizations.
    " Everyone may do everything in this demo; deny nothing.
    result = VALUE #( FOR key IN keys ( %tky    = key-%tky
                                        %update = if_abap_behv=>auth-allowed
                                        %delete = if_abap_behv=>auth-allowed ) ).
  ENDMETHOD.

  METHOD releaseOrder.
    READ ENTITIES OF zr_salesorder IN LOCAL MODE
      ENTITY SalesOrder FIELDS ( OrderID ) WITH CORRESPONDING #( keys )
      RESULT DATA(orders)
      ENTITY SalesOrder BY \_Item FIELDS ( ItemUUID ) WITH CORRESPONDING #( keys )
      RESULT DATA(items)
      LINK DATA(links).

    LOOP AT orders INTO DATA(order).
      IF NOT line_exists( links[ source-%tky = order-%tky ] ).
        APPEND VALUE #( %tky = order-%tky ) TO failed-salesorder.
        APPEND VALUE #( %tky = order-%tky
                        %msg = new_message_with_text( text = 'A sales order without items cannot be released' ) ) TO reported-salesorder.
      ENDIF.
    ENDLOOP.
    CHECK failed-salesorder IS INITIAL.

    MODIFY ENTITIES OF zr_salesorder IN LOCAL MODE
      ENTITY SalesOrder
        UPDATE FIELDS ( OverallStatus )
        WITH VALUE #( FOR key IN keys ( %tky          = key-%tky
                                        OverallStatus = order_status-released ) ).

    READ ENTITIES OF zr_salesorder IN LOCAL MODE
      ENTITY SalesOrder ALL FIELDS WITH CORRESPONDING #( keys )
      RESULT DATA(released).
    result = VALUE #( FOR r IN released ( %tky = r-%tky %param = r ) ).

    LOOP AT released INTO DATA(o).
      APPEND VALUE #( %tky = o-%tky
                      %msg = new_message( id       = 'ZSALESORDER'
                                          number   = '003'
                                          severity = if_abap_behv_message=>severity-success
                                          v1       = |{ o-OrderID ALPHA = OUT }| ) ) TO reported-salesorder.
    ENDLOOP.
  ENDMETHOD.

  METHOD cancelOrder.
    MODIFY ENTITIES OF zr_salesorder IN LOCAL MODE
      ENTITY SalesOrder
        UPDATE FIELDS ( OverallStatus )
        WITH VALUE #( FOR key IN keys ( %tky          = key-%tky
                                        OverallStatus = order_status-cancelled ) ).

    READ ENTITIES OF zr_salesorder IN LOCAL MODE
      ENTITY SalesOrder ALL FIELDS WITH CORRESPONDING #( keys )
      RESULT DATA(cancelled).
    result = VALUE #( FOR c IN cancelled ( %tky = c-%tky %param = c ) ).

    LOOP AT cancelled INTO DATA(o).
      APPEND VALUE #( %tky = o-%tky
                      %msg = new_message( id       = 'ZSALESORDER'
                                          number   = '004'
                                          severity = if_abap_behv_message=>severity-success
                                          v1       = |{ o-OrderID ALPHA = OUT }| ) ) TO reported-salesorder.
    ENDLOOP.
  ENDMETHOD.

  METHOD recalcGrossAmount.
    TYPES ty_amount TYPE p LENGTH 16 DECIMALS 2.

    READ ENTITIES OF zr_salesorder IN LOCAL MODE
      ENTITY SalesOrder FIELDS ( CurrencyCode ) WITH CORRESPONDING #( keys )
      RESULT DATA(orders).

    LOOP AT orders ASSIGNING FIELD-SYMBOL(<order>).
      READ ENTITIES OF zr_salesorder IN LOCAL MODE
        ENTITY SalesOrder BY \_Item
          FIELDS ( NetAmount )
          WITH VALUE #( ( %tky = <order>-%tky ) )
        RESULT DATA(items).

      <order>-GrossAmount = REDUCE ty_amount( INIT sum = CONV ty_amount( 0 )
                                              FOR item IN items
                                              NEXT sum = sum + item-NetAmount ).
    ENDLOOP.

    MODIFY ENTITIES OF zr_salesorder IN LOCAL MODE
      ENTITY SalesOrder
        UPDATE FIELDS ( GrossAmount )
        WITH CORRESPONDING #( orders ).
  ENDMETHOD.

  METHOD setInitialValues.
    READ ENTITIES OF zr_salesorder IN LOCAL MODE
      ENTITY SalesOrder FIELDS ( OverallStatus OrderDate CurrencyCode ) WITH CORRESPONDING #( keys )
      RESULT DATA(orders).

    DELETE orders WHERE OverallStatus IS NOT INITIAL AND OrderDate IS NOT INITIAL AND CurrencyCode IS NOT INITIAL.
    CHECK orders IS NOT INITIAL.

    DATA(today) = cl_abap_context_info=>get_system_date( ).

    MODIFY ENTITIES OF zr_salesorder IN LOCAL MODE
      ENTITY SalesOrder
        UPDATE FIELDS ( OverallStatus OrderDate CurrencyCode )
        WITH VALUE #( FOR order IN orders
                      ( %tky          = order-%tky
                        OverallStatus = COND #( WHEN order-OverallStatus IS INITIAL THEN order_status-new ELSE order-OverallStatus )
                        OrderDate     = COND #( WHEN order-OrderDate IS INITIAL THEN today ELSE order-OrderDate )
                        CurrencyCode  = COND #( WHEN order-CurrencyCode IS INITIAL THEN 'EUR' ELSE order-CurrencyCode ) ) ).
  ENDMETHOD.

  METHOD calculateGross.
    " the items always carry the currency of their order
    READ ENTITIES OF zr_salesorder IN LOCAL MODE
      ENTITY SalesOrder FIELDS ( CurrencyCode ) WITH CORRESPONDING #( keys )
      RESULT DATA(orders)
      ENTITY SalesOrder BY \_Item FIELDS ( CurrencyCode ) WITH CORRESPONDING #( keys )
      RESULT DATA(items)
      LINK DATA(links).

    LOOP AT items ASSIGNING FIELD-SYMBOL(<item>).
      DATA(order_key) = links[ target-%tky = <item>-%tky ]-source-%tky.
      <item>-CurrencyCode = orders[ %tky = order_key ]-CurrencyCode.
    ENDLOOP.

    IF items IS NOT INITIAL.
      MODIFY ENTITIES OF zr_salesorder IN LOCAL MODE
        ENTITY Item
          UPDATE FIELDS ( CurrencyCode )
          WITH CORRESPONDING #( items ).
    ENDIF.

    MODIFY ENTITIES OF zr_salesorder IN LOCAL MODE
      ENTITY SalesOrder
        EXECUTE recalcGrossAmount
        FROM CORRESPONDING #( keys ).
  ENDMETHOD.

  METHOD calculateOrderID.
    READ ENTITIES OF zr_salesorder IN LOCAL MODE
      ENTITY SalesOrder FIELDS ( OrderID ) WITH CORRESPONDING #( keys )
      RESULT DATA(orders).

    DELETE orders WHERE OrderID IS NOT INITIAL.
    CHECK orders IS NOT INITIAL.

    SELECT SINGLE FROM zsalesorder_a FIELDS MAX( order_id ) INTO @DATA(max_order_id).

    MODIFY ENTITIES OF zr_salesorder IN LOCAL MODE
      ENTITY SalesOrder
        UPDATE FIELDS ( OrderID )
        WITH VALUE #( FOR order IN orders INDEX INTO i
                        ( %tky    = order-%tky
                          OrderID = max_order_id + i ) ).
  ENDMETHOD.

  METHOD validateCustomer.
    READ ENTITIES OF zr_salesorder IN LOCAL MODE
      ENTITY SalesOrder FIELDS ( CustomerID ) WITH CORRESPONDING #( keys )
      RESULT DATA(orders).

    DATA customers TYPE SORTED TABLE OF zsocustomer_a WITH UNIQUE KEY customer_id.
    customers = CORRESPONDING #( orders DISCARDING DUPLICATES MAPPING customer_id = CustomerID EXCEPT * ).
    DELETE customers WHERE customer_id IS INITIAL.

    IF customers IS NOT INITIAL.
      SELECT FROM zsocustomer_a FIELDS customer_id
        FOR ALL ENTRIES IN @customers
        WHERE customer_id = @customers-customer_id
        INTO TABLE @DATA(valid_customers).
    ENDIF.

    LOOP AT orders INTO DATA(order).
      IF order-CustomerID IS INITIAL.
        APPEND VALUE #( %tky = order-%tky ) TO failed-salesorder.
        APPEND VALUE #( %tky                = order-%tky
                        %msg                = new_message_with_text( text = 'Customer is required' )
                        %element-CustomerID = if_abap_behv=>mk-on ) TO reported-salesorder.
      ELSEIF NOT line_exists( valid_customers[ customer_id = order-CustomerID ] ).
        APPEND VALUE #( %tky = order-%tky ) TO failed-salesorder.
        APPEND VALUE #( %tky                = order-%tky
                        %msg                = new_message( id       = 'ZSALESORDER'
                                                           number   = '001'
                                                           severity = if_abap_behv_message=>severity-error
                                                           v1       = order-CustomerID )
                        %element-CustomerID = if_abap_behv=>mk-on ) TO reported-salesorder.
      ENDIF.
    ENDLOOP.
  ENDMETHOD.

  METHOD validateDates.
    READ ENTITIES OF zr_salesorder IN LOCAL MODE
      ENTITY SalesOrder FIELDS ( OrderDate DeliveryDate ) WITH CORRESPONDING #( keys )
      RESULT DATA(orders).

    LOOP AT orders INTO DATA(order).
      IF order-DeliveryDate IS INITIAL.
        APPEND VALUE #( %tky = order-%tky ) TO failed-salesorder.
        APPEND VALUE #( %tky                  = order-%tky
                        %msg                  = new_message_with_text( text = 'Requested delivery date is required' )
                        %element-DeliveryDate = if_abap_behv=>mk-on ) TO reported-salesorder.
      ELSEIF order-DeliveryDate < order-OrderDate.
        APPEND VALUE #( %tky = order-%tky ) TO failed-salesorder.
        APPEND VALUE #( %tky                  = order-%tky
                        %msg                  = new_message_with_text( text = |Delivery date { order-DeliveryDate DATE = ISO } is before order date { order-OrderDate DATE = ISO }| )
                        %element-OrderDate    = if_abap_behv=>mk-on
                        %element-DeliveryDate = if_abap_behv=>mk-on ) TO reported-salesorder.
      ENDIF.
    ENDLOOP.
  ENDMETHOD.

ENDCLASS.

CLASS lhc_item DEFINITION INHERITING FROM cl_abap_behavior_handler.
  PRIVATE SECTION.
    METHODS setItemDefaults FOR DETERMINE ON MODIFY
      IMPORTING keys FOR Item~setItemDefaults.
    METHODS calculateGross FOR DETERMINE ON MODIFY
      IMPORTING keys FOR Item~calculateGross.
    METHODS validateProduct FOR VALIDATE ON SAVE
      IMPORTING keys FOR Item~validateProduct.
    METHODS validateQuantity FOR VALIDATE ON SAVE
      IMPORTING keys FOR Item~validateQuantity.
ENDCLASS.

CLASS lhc_item IMPLEMENTATION.

  METHOD setItemDefaults.
    READ ENTITIES OF zr_salesorder IN LOCAL MODE
      ENTITY Item FIELDS ( ItemNo ProductID Quantity QuantityUnit UnitPrice NetAmount CurrencyCode ) WITH CORRESPONDING #( keys )
      RESULT DATA(items)
      ENTITY Item BY \_SalesOrder FIELDS ( CurrencyCode ) WITH CORRESPONDING #( keys )
      RESULT DATA(orders)
      LINK DATA(links).

    DATA products TYPE SORTED TABLE OF zsoproduct_a WITH UNIQUE KEY product_id.
    products = CORRESPONDING #( items DISCARDING DUPLICATES MAPPING product_id = ProductID EXCEPT * ).
    DELETE products WHERE product_id IS INITIAL.

    IF products IS NOT INITIAL.
      SELECT FROM zsoproduct_a FIELDS product_id, price, base_unit
        FOR ALL ENTRIES IN @products
        WHERE product_id = @products-product_id
        INTO TABLE @DATA(product_data).
    ENDIF.

    LOOP AT items ASSIGNING FIELD-SYMBOL(<item>).
      DATA(order_key) = links[ source-%tky = <item>-%tky ]-target-%tky.

      " next free item number inside the order (10, 20, 30, ...)
      IF <item>-ItemNo IS INITIAL.
        READ ENTITIES OF zr_salesorder IN LOCAL MODE
          ENTITY SalesOrder BY \_Item FIELDS ( ItemNo ) WITH VALUE #( ( %tky = order_key ) )
          RESULT DATA(siblings).
        DATA(max_no) = REDUCE i( INIT m = 0 FOR s IN siblings NEXT m = nmax( val1 = m val2 = s-ItemNo ) ).
        <item>-ItemNo = max_no + 10.
      ENDIF.

      DATA(product) = VALUE #( product_data[ product_id = <item>-ProductID ] OPTIONAL ).
      IF <item>-UnitPrice IS INITIAL.
        <item>-UnitPrice = product-price.
      ENDIF.
      IF <item>-QuantityUnit IS INITIAL.
        <item>-QuantityUnit = product-base_unit.
      ENDIF.
      <item>-CurrencyCode = VALUE #( orders[ %tky = order_key ]-CurrencyCode OPTIONAL ).
      <item>-NetAmount    = <item>-Quantity * <item>-UnitPrice.
    ENDLOOP.

    MODIFY ENTITIES OF zr_salesorder IN LOCAL MODE
      ENTITY Item
        UPDATE FIELDS ( ItemNo QuantityUnit UnitPrice NetAmount CurrencyCode )
        WITH CORRESPONDING #( items ).

    MODIFY ENTITIES OF zr_salesorder IN LOCAL MODE
      ENTITY SalesOrder
        EXECUTE recalcGrossAmount
        FROM CORRESPONDING #( orders ).
  ENDMETHOD.

  METHOD calculateGross.
    READ ENTITIES OF zr_salesorder IN LOCAL MODE
      ENTITY Item BY \_SalesOrder FIELDS ( OrderUUID ) WITH CORRESPONDING #( keys )
      RESULT DATA(orders).

    MODIFY ENTITIES OF zr_salesorder IN LOCAL MODE
      ENTITY SalesOrder
        EXECUTE recalcGrossAmount
        FROM CORRESPONDING #( orders ).
  ENDMETHOD.

  METHOD validateProduct.
    READ ENTITIES OF zr_salesorder IN LOCAL MODE
      ENTITY Item FIELDS ( ProductID ) WITH CORRESPONDING #( keys )
      RESULT DATA(items).

    DATA products TYPE SORTED TABLE OF zsoproduct_a WITH UNIQUE KEY product_id.
    products = CORRESPONDING #( items DISCARDING DUPLICATES MAPPING product_id = ProductID EXCEPT * ).
    DELETE products WHERE product_id IS INITIAL.

    IF products IS NOT INITIAL.
      SELECT FROM zsoproduct_a FIELDS product_id
        FOR ALL ENTRIES IN @products
        WHERE product_id = @products-product_id
        INTO TABLE @DATA(valid_products).
    ENDIF.

    LOOP AT items INTO DATA(item).
      IF item-ProductID IS INITIAL.
        APPEND VALUE #( %tky = item-%tky ) TO failed-item.
        APPEND VALUE #( %tky               = item-%tky
                        %msg               = new_message_with_text( text = 'Product is required' )
                        %element-ProductID = if_abap_behv=>mk-on ) TO reported-item.
      ELSEIF NOT line_exists( valid_products[ product_id = item-ProductID ] ).
        APPEND VALUE #( %tky = item-%tky ) TO failed-item.
        APPEND VALUE #( %tky               = item-%tky
                        %msg               = new_message( id       = 'ZSALESORDER'
                                                          number   = '002'
                                                          severity = if_abap_behv_message=>severity-error
                                                          v1       = item-ProductID )
                        %element-ProductID = if_abap_behv=>mk-on ) TO reported-item.
      ENDIF.
    ENDLOOP.
  ENDMETHOD.

  METHOD validateQuantity.
    READ ENTITIES OF zr_salesorder IN LOCAL MODE
      ENTITY Item FIELDS ( Quantity ) WITH CORRESPONDING #( keys )
      RESULT DATA(items).

    LOOP AT items INTO DATA(item) WHERE Quantity <= 0.
      APPEND VALUE #( %tky = item-%tky ) TO failed-item.
      APPEND VALUE #( %tky              = item-%tky
                      %msg              = new_message_with_text( text = 'Quantity must be greater than zero' )
                      %element-Quantity = if_abap_behv=>mk-on ) TO reported-item.
    ENDLOOP.
  ENDMETHOD.

ENDCLASS.
