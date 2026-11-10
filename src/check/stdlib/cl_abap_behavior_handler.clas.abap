CLASS cl_abap_behavior_handler DEFINITION PUBLIC ABSTRACT CREATE PUBLIC.
  PROTECTED SECTION.
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
CLASS cl_abap_behavior_handler IMPLEMENTATION.
  METHOD new_message.
  ENDMETHOD.
  METHOD new_message_with_text.
  ENDMETHOD.
ENDCLASS.
