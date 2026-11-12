CLASS ltc_fb DEFINITION FINAL FOR TESTING DURATION SHORT RISK LEVEL HARMLESS.
  PRIVATE SECTION.
    METHODS differs_by_reference FOR TESTING.
    METHODS equals_same_reference FOR TESTING.
ENDCLASS.

CLASS ltc_fb IMPLEMENTATION.
  METHOD differs_by_reference.
    " two objects with the same content are still two references
    DATA(a) = NEW zcl_fb_impl( ).
    DATA(b) = NEW zcl_fb_impl( ).
    cl_abap_unit_assert=>assert_differs( act = a exp = b ).
    DATA(ra) = NEW i( 1 ).
    DATA(rb) = NEW i( 1 ).
    cl_abap_unit_assert=>assert_differs( act = ra exp = rb ).
  ENDMETHOD.

  METHOD equals_same_reference.
    DATA(a) = NEW zcl_fb_impl( ).
    DATA(c) = a.
    cl_abap_unit_assert=>assert_equals( act = c exp = a ).
  ENDMETHOD.
ENDCLASS.
