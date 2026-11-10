CLASS lhc_doc_ext DEFINITION INHERITING FROM cl_abap_behavior_handler.
  PRIVATE SECTION.
    METHODS normalizetitle FOR DETERMINE ON MODIFY IMPORTING keys FOR Doc~normalizeTitle.
ENDCLASS.

CLASS lhc_doc_ext IMPLEMENTATION.
  METHOD normalizetitle.
    READ ENTITIES OF zr_doc IN LOCAL MODE ENTITY Doc FIELDS ( Title ) WITH CORRESPONDING #( keys ) RESULT DATA(lt_docs).
    MODIFY ENTITIES OF zr_doc IN LOCAL MODE ENTITY Doc UPDATE FIELDS ( Title )
      WITH VALUE #( FOR d IN lt_docs ( %tky = d-%tky Title = to_upper( d-Title ) ) ).
  ENDMETHOD.
ENDCLASS.
