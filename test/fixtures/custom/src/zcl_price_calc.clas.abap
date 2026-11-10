CLASS zcl_price_calc DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    METHODS discounted IMPORTING iv_carrier TYPE zflight_a-carrier_id RETURNING VALUE(rv_price) TYPE zflight_a-price.
ENDCLASS.

CLASS zcl_price_calc IMPLEMENTATION.
  METHOD discounted.
    DATA lv_rate TYPE i.
    TEST-SEAM discount_rate.
      lv_rate = 10.
    END-TEST-SEAM.
    SELECT SUM( price ) FROM zflight_a WHERE carrier_id = @iv_carrier INTO @DATA(lv_sum).
    rv_price = lv_sum * ( 100 - lv_rate ) / 100.
  ENDMETHOD.
ENDCLASS.
