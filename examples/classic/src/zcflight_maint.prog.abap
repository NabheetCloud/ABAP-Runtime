PROGRAM zcflight_maint.

* Module pool: transaction ZCFL shows one flight and changes its price. Display locks the flight
* (lock object EZCFLIGHT) for this session until it is saved.

DATA gv_ok_code TYPE sy-ucomm.
DATA gv_carrier TYPE c LENGTH 3.
DATA gv_connection TYPE n LENGTH 4.
DATA gv_city TYPE c LENGTH 20.
DATA gv_price TYPE p LENGTH 6 DECIMALS 2.

MODULE status_0100 OUTPUT.
  SET PF-STATUS 'MAIN'.
  SET TITLEBAR 'MAIN'.
ENDMODULE.

MODULE exit_0100 INPUT.
  CLEAR gv_ok_code.
  LEAVE TO SCREEN 0.
ENDMODULE.

MODULE user_command_0100 INPUT.
  CASE gv_ok_code.
    WHEN 'SHOW'.
      SELECT SINGLE city_from, price FROM zcflight_a
        WHERE carrier_id = @gv_carrier AND connection_id = @gv_connection
        INTO (@gv_city, @gv_price).
      IF sy-subrc = 0.
        CALL FUNCTION 'ENQUEUE_EZCFLIGHT'
          EXPORTING
            carrier_id    = gv_carrier
            connection_id = gv_connection
          EXCEPTIONS
            foreign_lock  = 1
            OTHERS        = 2.
        IF sy-subrc <> 0.
          MESSAGE |Flight { gv_carrier } { gv_connection } is locked by user { sy-msgv1 }| TYPE 'S' DISPLAY LIKE 'E'.
          RETURN.
        ENDIF.
        MESSAGE |Flight { gv_carrier } { gv_connection } found| TYPE 'S'.
      ELSE.
        CLEAR: gv_city, gv_price.
        MESSAGE |Flight { gv_carrier } { gv_connection } does not exist| TYPE 'S' DISPLAY LIKE 'E'.
      ENDIF.
    WHEN 'SAVE'.
      UPDATE zcflight_a SET price = @gv_price
        WHERE carrier_id = @gv_carrier AND connection_id = @gv_connection.
      IF sy-subrc = 0.
        CALL FUNCTION 'DEQUEUE_EZCFLIGHT'
          EXPORTING
            carrier_id    = gv_carrier
            connection_id = gv_connection.
        MESSAGE |Price of { gv_carrier } { gv_connection } saved| TYPE 'S'.
      ELSE.
        MESSAGE |Flight { gv_carrier } { gv_connection } does not exist| TYPE 'S' DISPLAY LIKE 'E'.
      ENDIF.
  ENDCASE.
  CLEAR gv_ok_code.
ENDMODULE.
