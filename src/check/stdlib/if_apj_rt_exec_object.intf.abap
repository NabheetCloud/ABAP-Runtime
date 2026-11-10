INTERFACE if_apj_rt_exec_object PUBLIC.
  TYPES: BEGIN OF ty_templ_val,
           selname TYPE c LENGTH 8,
           kind    TYPE c LENGTH 1,
           sign    TYPE c LENGTH 1,
           option  TYPE c LENGTH 2,
           low     TYPE string,
           high    TYPE string,
         END OF ty_templ_val,
         tt_templ_val TYPE STANDARD TABLE OF ty_templ_val WITH DEFAULT KEY.
  METHODS execute
    IMPORTING it_parameters TYPE tt_templ_val
    RAISING   cx_apj_rt_content.
ENDINTERFACE.
