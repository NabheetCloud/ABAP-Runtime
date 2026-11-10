CLASS cx_root DEFINITION PUBLIC ABSTRACT CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES if_message.
    DATA textid TYPE c LENGTH 32 READ-ONLY.
    DATA previous TYPE REF TO cx_root READ-ONLY.
    DATA is_resumable TYPE abap_bool READ-ONLY.
    DATA kernel_errid TYPE c LENGTH 30 READ-ONLY.
    METHODS constructor IMPORTING textid LIKE textid OPTIONAL previous LIKE previous OPTIONAL.
    METHODS get_text RETURNING VALUE(result) TYPE string.
    METHODS get_longtext IMPORTING preserve_newlines TYPE abap_bool OPTIONAL RETURNING VALUE(result) TYPE string.
    METHODS get_source_position EXPORTING program_name TYPE string include_name TYPE string source_line TYPE i.
ENDCLASS.
CLASS cx_root IMPLEMENTATION.
  METHOD constructor.
  ENDMETHOD.
  METHOD get_text.
  ENDMETHOD.
  METHOD get_longtext.
  ENDMETHOD.
  METHOD get_source_position.
  ENDMETHOD.
  METHOD if_message~get_text.
  ENDMETHOD.
  METHOD if_message~get_longtext.
  ENDMETHOD.
ENDCLASS.
