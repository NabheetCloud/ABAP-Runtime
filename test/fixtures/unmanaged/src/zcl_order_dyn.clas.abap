CLASS zcl_order_dyn DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-METHODS rename IMPORTING iv_order TYPE zlegacy_ord-order_no iv_customer TYPE zlegacy_ord-customer
                         RETURNING VALUE(rv_customer) TYPE zlegacy_ord-customer.
ENDCLASS.

CLASS zcl_order_dyn IMPLEMENTATION.
  METHOD rename.
    DATA lt_update TYPE TABLE FOR UPDATE zr_legacyorder.
    DATA lt_keys TYPE TABLE FOR READ IMPORT zr_legacyorder.
    DATA lt_read TYPE TABLE FOR READ RESULT zr_legacyorder.
    lt_update = VALUE #( ( OrderNo = iv_order Customer = iv_customer %control-Customer = if_abap_behv=>mk-on ) ).
    DATA(lt_ops) = VALUE abp_behv_changes_tab( ( op = if_abap_behv=>op-m-update entity_name = 'ZR_LEGACYORDER' instances = REF #( lt_update ) ) ).
    MODIFY ENTITIES OPERATIONS lt_ops FAILED DATA(ls_failed).
    COMMIT ENTITIES.
    lt_keys = VALUE #( ( OrderNo = iv_order ) ).
    DATA(lt_rops) = VALUE abp_behv_retrievals_tab( ( op = if_abap_behv=>op-r-read entity_name = 'ZR_LEGACYORDER' instances = REF #( lt_keys ) results = REF #( lt_read ) ) ).
    READ ENTITIES OPERATIONS lt_rops.
    rv_customer = lt_read[ 1 ]-Customer.
  ENDMETHOD.
ENDCLASS.
