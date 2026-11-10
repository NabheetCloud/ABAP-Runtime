CLASS ltc_price DEFINITION FINAL FOR TESTING RISK LEVEL HARMLESS DURATION SHORT.
  PRIVATE SECTION.
    CLASS-DATA go_env TYPE REF TO if_osql_test_environment.
    DATA mo_cut TYPE REF TO zcl_price_calc.
    CLASS-METHODS class_setup.
    METHODS setup.
    METHODS discount_default FOR TESTING.
    METHODS discount_injected FOR TESTING.
    METHODS demo_failure FOR TESTING.
ENDCLASS.

CLASS ltc_price IMPLEMENTATION.
  METHOD class_setup.
    go_env = cl_osql_test_environment=>create( i_dependency_list = VALUE #( ( 'ZFLIGHT_A' ) ) ).
  ENDMETHOD.

  METHOD setup.
    DATA lt_flights TYPE STANDARD TABLE OF zflight_a WITH EMPTY KEY.
    go_env->clear_doubles( ).
    lt_flights = VALUE #( ( carrier_id = 'XX' connection_id = '0001' price = 100 )
                          ( carrier_id = 'XX' connection_id = '0002' price = 300 ) ).
    go_env->insert_test_data( lt_flights ).
    mo_cut = NEW #( ).
  ENDMETHOD.

  METHOD discount_default.
    cl_abap_unit_assert=>assert_equals( act = mo_cut->discounted( 'XX' ) exp = 360 ).
  ENDMETHOD.

  METHOD discount_injected.
    TEST-INJECTION discount_rate.
      lv_rate = 50.
    END-TEST-INJECTION.
    cl_abap_unit_assert=>assert_equals( act = mo_cut->discounted( 'XX' ) exp = 200 msg = 'half price' ).
  ENDMETHOD.

  METHOD demo_failure.
    cl_abap_unit_assert=>assert_equals( act = mo_cut->discounted( 'XX' ) exp = 1 msg = 'deliberately wrong' ).
  ENDMETHOD.
ENDCLASS.
