CLASS cl_system_uuid DEFINITION PUBLIC FINAL CREATE PRIVATE.
  PUBLIC SECTION.
    CLASS-METHODS create_uuid_x16_static RETURNING VALUE(uuid) TYPE sysuuid_x16 RAISING cx_uuid_error.
    CLASS-METHODS create_uuid_c32_static RETURNING VALUE(uuid) TYPE sysuuid_c32 RAISING cx_uuid_error.
    CLASS-METHODS create_uuid_c36_static RETURNING VALUE(uuid) TYPE sysuuid_c36 RAISING cx_uuid_error.
ENDCLASS.
CLASS cl_system_uuid IMPLEMENTATION.
  METHOD create_uuid_x16_static.
  ENDMETHOD.
  METHOD create_uuid_c32_static.
  ENDMETHOD.
  METHOD create_uuid_c36_static.
  ENDMETHOD.
ENDCLASS.
