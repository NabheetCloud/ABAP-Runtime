CLASS cl_abap_context_info DEFINITION PUBLIC FINAL CREATE PRIVATE.
  PUBLIC SECTION.
    CLASS-METHODS get_system_date RETURNING VALUE(result) TYPE d.
    CLASS-METHODS get_system_time RETURNING VALUE(result) TYPE t.
    CLASS-METHODS get_user_technical_name RETURNING VALUE(result) TYPE string RAISING cx_abap_context_info_error.
    CLASS-METHODS get_user_alias RETURNING VALUE(result) TYPE string RAISING cx_abap_context_info_error.
    CLASS-METHODS get_user_formatted_name RETURNING VALUE(result) TYPE string RAISING cx_abap_context_info_error.
    CLASS-METHODS get_user_language_abap_format RETURNING VALUE(result) TYPE c RAISING cx_abap_context_info_error.
ENDCLASS.
CLASS cl_abap_context_info IMPLEMENTATION.
  METHOD get_system_date.
  ENDMETHOD.
  METHOD get_system_time.
  ENDMETHOD.
  METHOD get_user_technical_name.
  ENDMETHOD.
  METHOD get_user_alias.
  ENDMETHOD.
  METHOD get_user_formatted_name.
  ENDMETHOD.
  METHOD get_user_language_abap_format.
  ENDMETHOD.
ENDCLASS.
