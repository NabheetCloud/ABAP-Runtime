CLASS lhc_sale DEFINITION INHERITING FROM cl_abap_behavior_handler.
  PRIVATE SECTION.
    METHODS get_global_authorizations FOR GLOBAL AUTHORIZATION
      IMPORTING REQUEST requested_authorizations FOR Sale RESULT result.
ENDCLASS.

CLASS lhc_sale IMPLEMENTATION.
  METHOD get_global_authorizations.
    COMMIT WORK.
    IF requested_authorizations-%update = if_abap_behv=>mk-on.
      AUTHORITY-CHECK OBJECT 'ZSALES' ID 'ACTVT' FIELD '02' ID 'ZREGION' DUMMY.
      result-%update = COND #( WHEN sy-subrc = 0 THEN if_abap_behv=>auth-allowed ELSE if_abap_behv=>auth-unauthorized ).
    ENDIF.
  ENDMETHOD.
ENDCLASS.
