"! Reads the attachment of document D2 in ABAP: its length and bytes (hex)
CLASS zcl_doc_attachment DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES if_oo_adt_classrun.
ENDCLASS.


CLASS zcl_doc_attachment IMPLEMENTATION.
  METHOD if_oo_adt_classrun~main.
    SELECT SINGLE attachment, mime_type FROM zdoc_a WHERE doc_id = 'D2' INTO @DATA(doc).
    out->write( |{ xstrlen( doc-attachment ) }:{ doc-attachment }:{ doc-mime_type }| ).
  ENDMETHOD.
ENDCLASS.
