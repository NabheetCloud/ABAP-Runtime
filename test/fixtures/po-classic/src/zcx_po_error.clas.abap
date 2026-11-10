"! Purchase order error
CLASS zcx_po_error DEFINITION PUBLIC INHERITING FROM cx_static_check FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    DATA mv_text TYPE string READ-ONLY.
    METHODS constructor IMPORTING textid LIKE textid OPTIONAL previous LIKE previous OPTIONAL text TYPE string OPTIONAL.
    METHODS get_text REDEFINITION.
ENDCLASS.

CLASS zcx_po_error IMPLEMENTATION.
  METHOD constructor ##ADT_SUPPRESS_GENERATION.
    super->constructor( textid = textid previous = previous ).
    mv_text = text.
  ENDMETHOD.
  METHOD get_text.
    result = COND #( WHEN mv_text IS NOT INITIAL THEN mv_text ELSE |Purchase order error| ).
  ENDMETHOD.
ENDCLASS.
