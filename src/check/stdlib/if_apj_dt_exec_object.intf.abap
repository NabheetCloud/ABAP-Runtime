INTERFACE if_apj_dt_exec_object PUBLIC.
  TYPES: BEGIN OF ty_templ_def,
           selname        TYPE c LENGTH 8,
           kind           TYPE c LENGTH 1,
           datatype       TYPE c LENGTH 4,
           length         TYPE i,
           decimals       TYPE i,
           param_text     TYPE c LENGTH 80,
           lowercase_ind  TYPE abap_bool,
           changeable_ind TYPE abap_bool,
           mandatory_ind  TYPE abap_bool,
           hidden_ind     TYPE abap_bool,
         END OF ty_templ_def,
         tt_templ_def TYPE STANDARD TABLE OF ty_templ_def WITH DEFAULT KEY.
  TYPES: BEGIN OF ty_templ_val,
           selname TYPE c LENGTH 8,
           kind    TYPE c LENGTH 1,
           sign    TYPE c LENGTH 1,
           option  TYPE c LENGTH 2,
           low     TYPE string,
           high    TYPE string,
         END OF ty_templ_val,
         tt_templ_val TYPE STANDARD TABLE OF ty_templ_val WITH DEFAULT KEY.
  METHODS get_parameters
    EXPORTING et_parameter_def TYPE tt_templ_def
              et_parameter_val TYPE tt_templ_val
    RAISING   cx_apj_dt_content.
ENDINTERFACE.
