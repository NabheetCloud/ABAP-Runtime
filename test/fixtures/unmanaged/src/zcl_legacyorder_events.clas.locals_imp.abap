CLASS lhe_order DEFINITION INHERITING FROM cl_abap_behavior_event_handler.
  PRIVATE SECTION.
    METHODS on_closed FOR ENTITY EVENT closed_orders FOR Order~Closed.
ENDCLASS.

CLASS lhe_order IMPLEMENTATION.
  METHOD on_closed.
    LOOP AT closed_orders INTO DATA(ls_order).
      INSERT zorder_log FROM @( VALUE #( order_no = ls_order-OrderNo note = 'closed, notify accounting' ) ).
    ENDLOOP.
  ENDMETHOD.
ENDCLASS.
