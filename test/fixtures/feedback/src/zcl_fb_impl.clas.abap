CLASS zcl_fb_impl DEFINITION PUBLIC CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES zif_fb.
    CLASS-DATA count TYPE i.
    DATA value TYPE i.
ENDCLASS.

CLASS zcl_fb_impl IMPLEMENTATION.
  METHOD zif_fb~bump.
    count = count + 1.
  ENDMETHOD.
ENDCLASS.
