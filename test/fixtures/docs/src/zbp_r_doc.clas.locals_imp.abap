CLASS lhc_doc DEFINITION INHERITING FROM cl_abap_behavior_handler.
  PRIVATE SECTION.
    METHODS get_instance_authorizations FOR INSTANCE AUTHORIZATION
      IMPORTING keys REQUEST requested_authorizations FOR Doc RESULT result.
ENDCLASS.

CLASS lhc_doc IMPLEMENTATION.
  METHOD get_instance_authorizations.
  ENDMETHOD.
ENDCLASS.
