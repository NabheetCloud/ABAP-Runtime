INTERFACE if_rap_query_request PUBLIC.
  TYPES: BEGIN OF ty_sort_element,
           element_name TYPE string,
           descending   TYPE abap_bool,
         END OF ty_sort_element,
         tt_sort_elements TYPE STANDARD TABLE OF ty_sort_element WITH EMPTY KEY,
         tt_requested_elements TYPE STANDARD TABLE OF string WITH EMPTY KEY.
  METHODS get_paging RETURNING VALUE(ro_paging) TYPE REF TO if_rap_query_paging.
  METHODS get_filter RETURNING VALUE(ro_filter) TYPE REF TO if_rap_query_filter.
  METHODS get_sort_elements RETURNING VALUE(rt_sort_elements) TYPE tt_sort_elements.
  METHODS get_requested_elements RETURNING VALUE(rt_requested_elements) TYPE tt_requested_elements.
  METHODS get_search_expression RETURNING VALUE(rv_search_expression) TYPE string.
  METHODS get_entity_id RETURNING VALUE(rv_entity_id) TYPE string.
  METHODS is_data_requested RETURNING VALUE(rv_is_requested) TYPE abap_bool.
  METHODS is_total_numb_of_rec_requested RETURNING VALUE(rv_is_requested) TYPE abap_bool.
ENDINTERFACE.
