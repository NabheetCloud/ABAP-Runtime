* Print forms (like SAP Interactive Forms by Adobe): the layout is the app's src/<form>.form.json, the data is any
* structure whose components the layout names ({field}, tables for repeating rows). RENDER returns the PDF;
* PRINT also puts it into the output queue (the studio's Output list). Rendered by RAP Studio with open-abap-pdf
* (src/classic/forms.mjs); sy-subrc = 4 when the form does not exist or cannot be rendered.
CLASS zcl_rap_form DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-METHODS render
      IMPORTING
        iv_form       TYPE csequence
        is_data       TYPE any
      RETURNING
        VALUE(rv_pdf) TYPE xstring.
    CLASS-METHODS print
      IMPORTING
        iv_form           TYPE csequence
        is_data           TYPE any
        iv_title          TYPE csequence OPTIONAL
      RETURNING
        VALUE(rv_request) TYPE i.
ENDCLASS.

CLASS zcl_rap_form IMPLEMENTATION.
  METHOD render.
    sy-subrc = 4.
  ENDMETHOD.
  METHOD print.
    sy-subrc = 4.
  ENDMETHOD.
ENDCLASS.
