"! Console demo (run it like F9 in ADT): EML against the Travel BO
CLASS zcl_travel_console DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES if_oo_adt_classrun.
ENDCLASS.

CLASS zcl_travel_console IMPLEMENTATION.
  METHOD if_oo_adt_classrun~main.
    " 1. ABAP SQL on the CDS view entity
    SELECT FROM zc_travel
      FIELDS TravelID, CustomerName, TotalPrice, CurrencyCode, StatusText
      ORDER BY TravelID
      INTO TABLE @DATA(travels).
    out->write( data = travels name = `Travels (ABAP SQL on ZC_Travel)` ).

    " 2. EML: create a travel with a booking in one request, then commit
    MODIFY ENTITIES OF zr_travel
      ENTITY Travel
        CREATE FIELDS ( CustomerID Description BeginDate EndDate BookingFee CurrencyCode )
        WITH VALUE #( ( %cid         = 'T1'
                        CustomerID   = '000002'
                        Description  = 'Created from the console'
                        BeginDate    = '20270901'
                        EndDate      = '20270910'
                        BookingFee   = 40
                        CurrencyCode = 'EUR' ) )
        CREATE BY \_Booking FIELDS ( CarrierID FlightDate FlightPrice )
        WITH VALUE #( ( %cid_ref = 'T1'
                        %target  = VALUE #( ( %cid = 'B1' CarrierID = 'LH' FlightDate = '20270901' FlightPrice = '512.40' ) ) ) )
      MAPPED DATA(mapped)
      FAILED DATA(failed)
      REPORTED DATA(reported).

    COMMIT ENTITIES RESPONSE OF zr_travel FAILED DATA(commit_failed) REPORTED DATA(commit_reported).
    IF commit_failed IS NOT INITIAL.
      LOOP AT commit_reported-travel INTO DATA(msg).
        out->write( |Error: { msg-%msg->if_message~get_text( ) }| ).
      ENDLOOP.
      RETURN.
    ENDIF.

    " 3. EML: read the new travel (the total was calculated by a determination)
    READ ENTITIES OF zr_travel
      ENTITY Travel ALL FIELDS WITH VALUE #( ( %tky = mapped-travel[ 1 ]-%tky ) )
      RESULT DATA(created).
    DATA(t) = created[ 1 ].
    out->write( |Created travel { t-TravelID ALPHA = OUT }: status { t-OverallStatus }, total { t-TotalPrice } { t-CurrencyCode }| ).

    " 4. EML: execute an action
    MODIFY ENTITIES OF zr_travel
      ENTITY Travel EXECUTE acceptTravel FROM VALUE #( ( %tky = t-%tky ) )
      RESULT DATA(accepted).
    COMMIT ENTITIES.
    out->write( |After acceptTravel: status { accepted[ 1 ]-%param-OverallStatus }| ).
  ENDMETHOD.
ENDCLASS.
