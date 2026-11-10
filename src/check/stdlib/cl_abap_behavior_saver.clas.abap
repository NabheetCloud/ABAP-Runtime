CLASS cl_abap_behavior_saver DEFINITION PUBLIC ABSTRACT CREATE PUBLIC.
  PROTECTED SECTION.
    METHODS finalize.
    METHODS check_before_save.
    METHODS save.
    METHODS cleanup.
    METHODS cleanup_finalize.
    METHODS adjust_numbers CHANGING mapped TYPE any OPTIONAL reported TYPE any OPTIONAL failed TYPE any OPTIONAL.
    METHODS save_modified IMPORTING create TYPE any OPTIONAL update TYPE any OPTIONAL delete TYPE any OPTIONAL
                          CHANGING reported TYPE any OPTIONAL failed TYPE any OPTIONAL.
    METHODS new_message
      IMPORTING id         TYPE csequence
                number     TYPE csequence
                severity   TYPE if_abap_behv_message=>t_severity
                v1         TYPE simple OPTIONAL
                v2         TYPE simple OPTIONAL
                v3         TYPE simple OPTIONAL
                v4         TYPE simple OPTIONAL
      RETURNING VALUE(obj) TYPE REF TO if_abap_behv_message.
    METHODS new_message_with_text
      IMPORTING severity   TYPE if_abap_behv_message=>t_severity DEFAULT if_abap_behv_message=>severity-error
                text       TYPE csequence OPTIONAL
      RETURNING VALUE(obj) TYPE REF TO if_abap_behv_message.
ENDCLASS.
CLASS cl_abap_behavior_saver IMPLEMENTATION.
  METHOD finalize.
  ENDMETHOD.
  METHOD check_before_save.
  ENDMETHOD.
  METHOD save.
  ENDMETHOD.
  METHOD cleanup.
  ENDMETHOD.
  METHOD cleanup_finalize.
  ENDMETHOD.
  METHOD adjust_numbers.
  ENDMETHOD.
  METHOD save_modified.
  ENDMETHOD.
  METHOD new_message.
  ENDMETHOD.
  METHOD new_message_with_text.
  ENDMETHOD.
ENDCLASS.
