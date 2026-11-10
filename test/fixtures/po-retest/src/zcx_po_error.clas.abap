"! PO error (texts from message class ZPO)
CLASS zcx_po_error DEFINITION PUBLIC INHERITING FROM cx_static_check FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES if_t100_message.

    CONSTANTS: BEGIN OF not_found,
                 msgid TYPE symsgid      VALUE 'ZPO',
                 msgno TYPE symsgno      VALUE '002',
                 attr1 TYPE scx_attrname VALUE 'MV_EBELN',
                 attr2 TYPE scx_attrname VALUE '',
                 attr3 TYPE scx_attrname VALUE '',
                 attr4 TYPE scx_attrname VALUE '',
               END OF not_found.
    CONSTANTS: BEGIN OF locked,
                 msgid TYPE symsgid      VALUE 'ZPO',
                 msgno TYPE symsgno      VALUE '003',
                 attr1 TYPE scx_attrname VALUE 'MV_EBELN',
                 attr2 TYPE scx_attrname VALUE '',
                 attr3 TYPE scx_attrname VALUE '',
                 attr4 TYPE scx_attrname VALUE '',
               END OF locked.
    CONSTANTS: BEGIN OF wrong_status,
                 msgid TYPE symsgid      VALUE 'ZPO',
                 msgno TYPE symsgno      VALUE '005',
                 attr1 TYPE scx_attrname VALUE 'MV_EBELN',
                 attr2 TYPE scx_attrname VALUE 'MV_STATUS',
                 attr3 TYPE scx_attrname VALUE '',
                 attr4 TYPE scx_attrname VALUE '',
               END OF wrong_status.

    DATA mv_ebeln  TYPE zpo_ebeln READ-ONLY.
    DATA mv_status TYPE zpo_stat  READ-ONLY.

    METHODS constructor
      IMPORTING textid    LIKE if_t100_message=>t100key OPTIONAL
                !previous LIKE previous                 OPTIONAL
                ebeln     TYPE zpo_ebeln                OPTIONAL
                !status   TYPE zpo_stat                 OPTIONAL.
ENDCLASS.


CLASS zcx_po_error IMPLEMENTATION.
  METHOD constructor ##ADT_SUPPRESS_GENERATION.
    super->constructor( previous = previous ).
    mv_ebeln = ebeln.
    mv_status = status.
    CLEAR me->textid.
    IF textid IS INITIAL.
      if_t100_message~t100key = if_t100_message=>default_textid.
    ELSE.
      if_t100_message~t100key = textid.
    ENDIF.
  ENDMETHOD.
ENDCLASS.
