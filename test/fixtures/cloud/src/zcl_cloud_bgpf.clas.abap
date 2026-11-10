CLASS zcl_cloud_bgpf DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES if_bgmc_op_single_tx_uncontr.
    METHODS constructor IMPORTING text TYPE string.
  PRIVATE SECTION.
    DATA mv_text TYPE string.
ENDCLASS.

CLASS zcl_cloud_bgpf IMPLEMENTATION.
  METHOD constructor.
    mv_text = text.
  ENDMETHOD.

  METHOD if_bgmc_op_single_tx_uncontr~execute.
    INSERT zcloud_run FROM @( VALUE #( id = cl_system_uuid=>create_uuid_c32_static( ) source = 'BGPF' text = mv_text ) ).
  ENDMETHOD.
ENDCLASS.
