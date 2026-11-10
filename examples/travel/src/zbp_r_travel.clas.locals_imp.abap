CLASS lhc_travel DEFINITION INHERITING FROM cl_abap_behavior_handler.
  PRIVATE SECTION.
    CONSTANTS:
      BEGIN OF travel_status,
        open     TYPE c LENGTH 1 VALUE 'O',
        accepted TYPE c LENGTH 1 VALUE 'A',
        rejected TYPE c LENGTH 1 VALUE 'X',
      END OF travel_status.

    METHODS get_instance_features FOR INSTANCE FEATURES
      IMPORTING keys REQUEST requested_features FOR Travel RESULT result.
    METHODS get_instance_authorizations FOR INSTANCE AUTHORIZATION
      IMPORTING keys REQUEST requested_authorizations FOR Travel RESULT result.
    METHODS acceptTravel FOR MODIFY
      IMPORTING keys FOR ACTION Travel~acceptTravel RESULT result.
    METHODS rejectTravel FOR MODIFY
      IMPORTING keys FOR ACTION Travel~rejectTravel RESULT result.
    METHODS reCalcTotalPrice FOR MODIFY
      IMPORTING keys FOR ACTION Travel~reCalcTotalPrice.
    METHODS setStatusToOpen FOR DETERMINE ON MODIFY
      IMPORTING keys FOR Travel~setStatusToOpen.
    METHODS calculateTotal FOR DETERMINE ON MODIFY
      IMPORTING keys FOR Travel~calculateTotal.
    METHODS calculateTravelID FOR DETERMINE ON SAVE
      IMPORTING keys FOR Travel~calculateTravelID.
    METHODS validateCustomer FOR VALIDATE ON SAVE
      IMPORTING keys FOR Travel~validateCustomer.
    METHODS validateDates FOR VALIDATE ON SAVE
      IMPORTING keys FOR Travel~validateDates.
ENDCLASS.

CLASS lhc_travel IMPLEMENTATION.

  METHOD get_instance_features.
    READ ENTITIES OF zr_travel IN LOCAL MODE
      ENTITY Travel
        FIELDS ( OverallStatus ) WITH CORRESPONDING #( keys )
      RESULT DATA(travels)
      FAILED failed.

    result = VALUE #( FOR travel IN travels
                      ( %tky                   = travel-%tky
                        %update                = COND #( WHEN travel-OverallStatus = travel_status-accepted
                                                         THEN if_abap_behv=>fc-o-disabled ELSE if_abap_behv=>fc-o-enabled )
                        %delete                = COND #( WHEN travel-OverallStatus = travel_status-accepted
                                                         THEN if_abap_behv=>fc-o-disabled ELSE if_abap_behv=>fc-o-enabled )
                        %action-acceptTravel   = COND #( WHEN travel-OverallStatus = travel_status-accepted
                                                         THEN if_abap_behv=>fc-o-disabled ELSE if_abap_behv=>fc-o-enabled )
                        %action-rejectTravel   = COND #( WHEN travel-OverallStatus = travel_status-rejected
                                                         THEN if_abap_behv=>fc-o-disabled ELSE if_abap_behv=>fc-o-enabled )
                        %assoc-_Booking        = COND #( WHEN travel-OverallStatus = travel_status-rejected
                                                         THEN if_abap_behv=>fc-o-disabled ELSE if_abap_behv=>fc-o-enabled ) ) ).
  ENDMETHOD.

  METHOD get_instance_authorizations.
    " Everyone may do everything in this demo; deny nothing.
    result = VALUE #( FOR key IN keys ( %tky    = key-%tky
                                        %update = if_abap_behv=>auth-allowed
                                        %delete = if_abap_behv=>auth-allowed ) ).
  ENDMETHOD.

  METHOD acceptTravel.
    MODIFY ENTITIES OF zr_travel IN LOCAL MODE
      ENTITY Travel
        UPDATE FIELDS ( OverallStatus RejectReason )
        WITH VALUE #( FOR key IN keys ( %tky          = key-%tky
                                        OverallStatus = travel_status-accepted
                                        RejectReason  = `` ) ).

    READ ENTITIES OF zr_travel IN LOCAL MODE
      ENTITY Travel ALL FIELDS WITH CORRESPONDING #( keys )
      RESULT DATA(travels).

    result = VALUE #( FOR travel IN travels ( %tky = travel-%tky %param = travel ) ).

    LOOP AT travels INTO DATA(t).
      APPEND VALUE #( %tky = t-%tky
                      %msg = new_message_with_text( severity = if_abap_behv_message=>severity-success
                                                    text     = |Travel { t-TravelID ALPHA = OUT } accepted| ) ) TO reported-travel.
    ENDLOOP.
  ENDMETHOD.

  METHOD rejectTravel.
    LOOP AT keys INTO DATA(key) WHERE %param-Reason IS INITIAL.
      APPEND VALUE #( %tky = key-%tky ) TO failed-travel.
      APPEND VALUE #( %tky = key-%tky
                      %msg = new_message_with_text( text = 'Please enter a reason for the rejection' ) ) TO reported-travel.
    ENDLOOP.
    CHECK failed-travel IS INITIAL.

    MODIFY ENTITIES OF zr_travel IN LOCAL MODE
      ENTITY Travel
        UPDATE FIELDS ( OverallStatus RejectReason )
        WITH VALUE #( FOR k IN keys ( %tky          = k-%tky
                                      OverallStatus = travel_status-rejected
                                      RejectReason  = k-%param-Reason ) ).

    READ ENTITIES OF zr_travel IN LOCAL MODE
      ENTITY Travel ALL FIELDS WITH CORRESPONDING #( keys )
      RESULT DATA(travels).
    result = VALUE #( FOR travel IN travels ( %tky = travel-%tky %param = travel ) ).
  ENDMETHOD.

  METHOD reCalcTotalPrice.
    TYPES: BEGIN OF ty_amount,
             amount   TYPE p LENGTH 16 DECIMALS 2,
             currency TYPE c LENGTH 5,
           END OF ty_amount.

    READ ENTITIES OF zr_travel IN LOCAL MODE
      ENTITY Travel FIELDS ( BookingFee CurrencyCode ) WITH CORRESPONDING #( keys )
      RESULT DATA(travels).

    LOOP AT travels ASSIGNING FIELD-SYMBOL(<travel>).
      READ ENTITIES OF zr_travel IN LOCAL MODE
        ENTITY Travel BY \_Booking
          FIELDS ( FlightPrice CurrencyCode )
          WITH VALUE #( ( %tky = <travel>-%tky ) )
        RESULT DATA(bookings).

      " flights in another currency are ignored in this simple demo
      DATA(flights) = REDUCE ty_amount-amount( INIT sum = CONV ty_amount-amount( 0 )
                                              FOR b IN bookings WHERE ( CurrencyCode = <travel>-CurrencyCode OR CurrencyCode IS INITIAL )
                                              NEXT sum = sum + b-FlightPrice ).
      <travel>-TotalPrice = <travel>-BookingFee + flights.
    ENDLOOP.

    MODIFY ENTITIES OF zr_travel IN LOCAL MODE
      ENTITY Travel
        UPDATE FIELDS ( TotalPrice )
        WITH CORRESPONDING #( travels ).
  ENDMETHOD.

  METHOD setStatusToOpen.
    READ ENTITIES OF zr_travel IN LOCAL MODE
      ENTITY Travel FIELDS ( OverallStatus ) WITH CORRESPONDING #( keys )
      RESULT DATA(travels).

    DELETE travels WHERE OverallStatus IS NOT INITIAL.
    CHECK travels IS NOT INITIAL.

    MODIFY ENTITIES OF zr_travel IN LOCAL MODE
      ENTITY Travel
        UPDATE FIELDS ( OverallStatus )
        WITH VALUE #( FOR travel IN travels ( %tky          = travel-%tky
                                              OverallStatus = travel_status-open ) ).
  ENDMETHOD.

  METHOD calculateTotal.
    MODIFY ENTITIES OF zr_travel IN LOCAL MODE
      ENTITY Travel
        EXECUTE reCalcTotalPrice
        FROM CORRESPONDING #( keys ).
  ENDMETHOD.

  METHOD calculateTravelID.
    READ ENTITIES OF zr_travel IN LOCAL MODE
      ENTITY Travel FIELDS ( TravelID ) WITH CORRESPONDING #( keys )
      RESULT DATA(travels).

    DELETE travels WHERE TravelID IS NOT INITIAL.
    CHECK travels IS NOT INITIAL.

    SELECT SINGLE FROM ztravel_a FIELDS MAX( travel_id ) INTO @DATA(max_travel_id).

    MODIFY ENTITIES OF zr_travel IN LOCAL MODE
      ENTITY Travel
        UPDATE FIELDS ( TravelID )
        WITH VALUE #( FOR travel IN travels INDEX INTO i
                        ( %tky     = travel-%tky
                          TravelID = max_travel_id + i ) ).
  ENDMETHOD.

  METHOD validateCustomer.
    READ ENTITIES OF zr_travel IN LOCAL MODE
      ENTITY Travel FIELDS ( CustomerID ) WITH CORRESPONDING #( keys )
      RESULT DATA(travels).

    DATA customers TYPE SORTED TABLE OF zcustomer_a WITH UNIQUE KEY customer_id.
    customers = CORRESPONDING #( travels DISCARDING DUPLICATES MAPPING customer_id = CustomerID EXCEPT * ).
    DELETE customers WHERE customer_id IS INITIAL.

    IF customers IS NOT INITIAL.
      SELECT FROM zcustomer_a FIELDS customer_id
        FOR ALL ENTRIES IN @customers
        WHERE customer_id = @customers-customer_id
        INTO TABLE @DATA(valid_customers).
    ENDIF.

    LOOP AT travels INTO DATA(travel).
      IF travel-CustomerID IS INITIAL.
        APPEND VALUE #( %tky = travel-%tky ) TO failed-travel.
        APPEND VALUE #( %tky                = travel-%tky
                        %msg                = new_message_with_text( text = 'Customer is required' )
                        %element-CustomerID = if_abap_behv=>mk-on ) TO reported-travel.
      ELSEIF NOT line_exists( valid_customers[ customer_id = travel-CustomerID ] ).
        APPEND VALUE #( %tky = travel-%tky ) TO failed-travel.
        APPEND VALUE #( %tky                = travel-%tky
                        %msg                = new_message( id       = 'ZTRAVEL'
                                                           number   = '001'
                                                           severity = if_abap_behv_message=>severity-error
                                                           v1       = travel-CustomerID )
                        %element-CustomerID = if_abap_behv=>mk-on ) TO reported-travel.
      ENDIF.
    ENDLOOP.
  ENDMETHOD.

  METHOD validateDates.
    READ ENTITIES OF zr_travel IN LOCAL MODE
      ENTITY Travel FIELDS ( BeginDate EndDate ) WITH CORRESPONDING #( keys )
      RESULT DATA(travels).

    DATA(today) = cl_abap_context_info=>get_system_date( ).

    LOOP AT travels INTO DATA(travel).
      IF travel-EndDate < travel-BeginDate AND travel-EndDate IS NOT INITIAL.
        APPEND VALUE #( %tky = travel-%tky ) TO failed-travel.
        APPEND VALUE #( %tky               = travel-%tky
                        %msg               = new_message_with_text( text = |End date { travel-EndDate DATE = ISO } is before begin date { travel-BeginDate DATE = ISO }| )
                        %element-BeginDate = if_abap_behv=>mk-on
                        %element-EndDate   = if_abap_behv=>mk-on ) TO reported-travel.
      ELSEIF travel-BeginDate < today AND travel-BeginDate IS NOT INITIAL.
        APPEND VALUE #( %tky = travel-%tky ) TO failed-travel.
        APPEND VALUE #( %tky               = travel-%tky
                        %msg               = new_message_with_text( text = 'Begin date must not be in the past' )
                        %element-BeginDate = if_abap_behv=>mk-on ) TO reported-travel.
      ENDIF.
    ENDLOOP.
  ENDMETHOD.

ENDCLASS.

CLASS lhc_booking DEFINITION INHERITING FROM cl_abap_behavior_handler.
  PRIVATE SECTION.
    METHODS setBookingDefaults FOR DETERMINE ON MODIFY
      IMPORTING keys FOR Booking~setBookingDefaults.
    METHODS calculateTotal FOR DETERMINE ON MODIFY
      IMPORTING keys FOR Booking~calculateTotal.
    METHODS validateFlightDate FOR VALIDATE ON SAVE
      IMPORTING keys FOR Booking~validateFlightDate.
ENDCLASS.

CLASS lhc_booking IMPLEMENTATION.

  METHOD setBookingDefaults.
    READ ENTITIES OF zr_travel IN LOCAL MODE
      ENTITY Booking FIELDS ( BookingID BookingDate BookingStatus CurrencyCode ) WITH CORRESPONDING #( keys )
      RESULT DATA(bookings)
      ENTITY Booking BY \_Travel FIELDS ( CurrencyCode ) WITH CORRESPONDING #( keys )
      RESULT DATA(travels)
      LINK DATA(links).

    LOOP AT bookings INTO DATA(booking).
      " next free booking number inside the travel
      DATA(travel_key) = links[ source-%tky = booking-%tky ]-target-%tky.
      READ ENTITIES OF zr_travel IN LOCAL MODE
        ENTITY Travel BY \_Booking FIELDS ( BookingID ) WITH VALUE #( ( %tky = travel_key ) )
        RESULT DATA(siblings).
      DATA(max_id) = REDUCE i( INIT m = 0 FOR s IN siblings NEXT m = nmax( val1 = m val2 = s-BookingID ) ).

      MODIFY ENTITIES OF zr_travel IN LOCAL MODE
        ENTITY Booking
          UPDATE FIELDS ( BookingID BookingDate BookingStatus CurrencyCode )
          WITH VALUE #( ( %tky          = booking-%tky
                          BookingID     = COND #( WHEN booking-BookingID IS INITIAL THEN max_id + 1 ELSE booking-BookingID )
                          BookingDate   = COND #( WHEN booking-BookingDate IS INITIAL THEN cl_abap_context_info=>get_system_date( ) ELSE booking-BookingDate )
                          BookingStatus = COND #( WHEN booking-BookingStatus IS INITIAL THEN 'N' ELSE booking-BookingStatus )
                          CurrencyCode  = COND #( WHEN booking-CurrencyCode IS INITIAL
                                                  THEN VALUE #( travels[ %tky = travel_key ]-CurrencyCode OPTIONAL )
                                                  ELSE booking-CurrencyCode ) ) ).
    ENDLOOP.
  ENDMETHOD.

  METHOD calculateTotal.
    READ ENTITIES OF zr_travel IN LOCAL MODE
      ENTITY Booking BY \_Travel FIELDS ( TravelUUID ) WITH CORRESPONDING #( keys )
      RESULT DATA(travels).

    MODIFY ENTITIES OF zr_travel IN LOCAL MODE
      ENTITY Travel
        EXECUTE reCalcTotalPrice
        FROM CORRESPONDING #( travels ).
  ENDMETHOD.

  METHOD validateFlightDate.
    READ ENTITIES OF zr_travel IN LOCAL MODE
      ENTITY Booking FIELDS ( FlightDate ) WITH CORRESPONDING #( keys )
      RESULT DATA(bookings).

    LOOP AT bookings INTO DATA(booking) WHERE FlightDate IS NOT INITIAL
                                          AND FlightDate < cl_abap_context_info=>get_system_date( ).
      APPEND VALUE #( %tky = booking-%tky ) TO failed-booking.
      APPEND VALUE #( %tky                = booking-%tky
                      %msg                = new_message_with_text( text = 'Flight date must not be in the past' )
                      %element-FlightDate = if_abap_behv=>mk-on ) TO reported-booking.
    ENDLOOP.
  ENDMETHOD.

ENDCLASS.
