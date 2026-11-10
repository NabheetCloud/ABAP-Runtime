"! Output of purchase orders with SAP's form APIs (run it as a console class: rap run . zcl_po_form_output)
"! - render_po / print_po: the purchase order form ZPURCHASE_ORDER (ABAP Cloud: form reader, form data provider,
"!   Adobe Document Services render_pdf, print queue)
"! - render_confirmation: the interactive goods receipt confirmation ZGR_CONFIRMATION (fillable PDF)
"! - read_confirmation: reads the filled-in confirmation back (field values, signature) and save_confirmation stores it
CLASS zcl_po_form_output DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES if_oo_adt_classrun.

    TYPES: BEGIN OF ty_confirmed_item,
             item_no      TYPE n LENGTH 5,
             product      TYPE string,
             ordered_qty  TYPE p LENGTH 13 DECIMALS 3,
             received_qty TYPE p LENGTH 13 DECIMALS 3,
             difference   TYPE p LENGTH 13 DECIMALS 3,
           END OF ty_confirmed_item,
           tt_confirmed_items TYPE STANDARD TABLE OF ty_confirmed_item WITH EMPTY KEY.
    TYPES: BEGIN OF ty_confirmation,
             po_number   TYPE n LENGTH 10,
             received_by TYPE string,
             received_on TYPE d,
             complete    TYPE abap_boolean,
             remark      TYPE string,
             is_signed   TYPE abap_boolean,
             signer      TYPE string,
             items       TYPE tt_confirmed_items,
           END OF ty_confirmation.

    "! the PDF of a purchase order (ABAP Cloud)
    "!
    "! @parameter iv_po_number |
    "! @parameter iv_locale |
    "! @parameter ev_pdf |
    "! @parameter ev_pages |
    "! @raising cx_fp_fdp_error |
    "! @raising cx_fp_ads_util |
    "! @raising cx_fp_form_reader |
    CLASS-METHODS render_po
      IMPORTING iv_po_number TYPE csequence
                iv_locale    TYPE csequence DEFAULT 'de_DE'
      EXPORTING ev_pdf       TYPE xstring
                ev_pages     TYPE i
      RAISING   cx_fp_fdp_error cx_fp_ads_util cx_fp_form_reader.

    "! prints a purchase order: the print queue item
    "!
    "! @parameter iv_po_number |
    "! @parameter rv_item |
    "! @raising cx_fp_fdp_error |
    "! @raising cx_fp_ads_util |
    "! @raising cx_fp_form_reader |
    CLASS-METHODS print_po
      IMPORTING iv_po_number   TYPE csequence
      RETURNING VALUE(rv_item) TYPE string
      RAISING   cx_fp_fdp_error cx_fp_ads_util cx_fp_form_reader.

    "! the fillable goods receipt confirmation of a purchase order
    "!
    "! @parameter iv_po_number |
    "! @parameter rv_pdf |
    "! @raising cx_fp_fdp_error |
    "! @raising cx_fp_ads_util |
    "! @raising cx_fp_form_reader |
    CLASS-METHODS render_confirmation
      IMPORTING iv_po_number  TYPE csequence
      RETURNING VALUE(rv_pdf) TYPE xstring
      RAISING   cx_fp_fdp_error cx_fp_ads_util cx_fp_form_reader.

    "! the values of a filled-in confirmation PDF, compared with the ordered quantities
    "!
    "! @parameter iv_po_number |
    "! @parameter iv_pdf |
    "! @parameter rs_confirmation |
    "! @raising cx_fp_runtime_usage |
    CLASS-METHODS read_confirmation
      IMPORTING iv_po_number           TYPE csequence
                iv_pdf                 TYPE xstring
      RETURNING VALUE(rs_confirmation) TYPE ty_confirmation
      RAISING   cx_fp_runtime_usage.

    "! stores a confirmation (a reprint of the form then shows it)
    "!
    "! @parameter is_confirmation |
    CLASS-METHODS save_confirmation
      IMPORTING is_confirmation TYPE ty_confirmation.

  PRIVATE SECTION.
    CLASS-METHODS render
      IMPORTING iv_form      TYPE csequence
                iv_po_number TYPE csequence
                iv_locale    TYPE csequence
      EXPORTING ev_pdf       TYPE xstring
                ev_pages     TYPE i
      RAISING   cx_fp_fdp_error cx_fp_ads_util cx_fp_form_reader.

    "! the value of one field in the form data XML (<data><FIELD>value</FIELD>…</data>)
    "!
    "! @parameter iv_xml |
    "! @parameter iv_field |
    "! @parameter rv_value |
    CLASS-METHODS xml_value
      IMPORTING iv_xml          TYPE string
                iv_field        TYPE csequence
      RETURNING VALUE(rv_value) TYPE string.

    CLASS-METHODS to_quantity
      IMPORTING iv_text       TYPE string
      RETURNING VALUE(rv_qty) TYPE ty_confirmed_item-received_qty.

    "! the date of an entered text (dd.mm.yyyy, mm/dd/yyyy or yyyy-mm-dd)
    "!
    "! @parameter iv_text |
    "! @parameter rv_date |
    CLASS-METHODS to_date
      IMPORTING iv_text        TYPE string
      RETURNING VALUE(rv_date) TYPE d.

    "! simulates the warehouse: the confirmation as it comes back filled in and signed
    "!
    "! @parameter iv_xml |
    "! @parameter iv_field |
    "! @parameter iv_value |
    "! @parameter rv_xml |
    CLASS-METHODS set_xml_value
      IMPORTING iv_xml        TYPE string
                iv_field      TYPE csequence
                iv_value      TYPE csequence
      RETURNING VALUE(rv_xml) TYPE string.

    CLASS-METHODS simulate_filled_form
      IMPORTING iv_po_number  TYPE csequence
      RETURNING VALUE(rv_pdf) TYPE xstring.
ENDCLASS.


CLASS zcl_po_form_output IMPLEMENTATION.
  METHOD render.
    DATA(reader) = cl_fp_form_reader=>create_form_reader( iv_form ).
    DATA(fdp) = cl_fp_fdp_services=>get_instance( reader->get_fdp_name( ) ).
    DATA(keys) = fdp->get_keys( ).
    keys[ name = 'PONUMBER' ]-value = iv_po_number.
    DATA(xml) = fdp->read_to_xml_v2( keys ).
    cl_fp_ads_util=>render_pdf( EXPORTING iv_xdp_layout = reader->get_layout( )
                                          iv_xml_data   = xml
                                          iv_locale     = iv_locale
                                IMPORTING ev_pdf        = ev_pdf
                                          ev_pages      = ev_pages ).
  ENDMETHOD.

  METHOD render_po.
    render( EXPORTING iv_form      = 'ZPURCHASE_ORDER'
                      iv_po_number = iv_po_number
                      iv_locale    = iv_locale
            IMPORTING ev_pdf       = ev_pdf
                      ev_pages     = ev_pages ).
  ENDMETHOD.

  METHOD print_po.
    DATA po_number TYPE n LENGTH 10.

    po_number = iv_po_number.
    render_po( EXPORTING iv_po_number = po_number
               IMPORTING ev_pdf       = DATA(pdf) ).
    rv_item = cl_print_queue_utils=>create_queue_item_by_data(
                  iv_qname            = 'PURCHASING'
                  iv_print_data       = pdf
                  iv_name_of_main_doc = |Purchase order { po_number ALPHA = OUT }| ).
  ENDMETHOD.

  METHOD render_confirmation.
    render( EXPORTING iv_form      = 'ZGR_CONFIRMATION'
                      iv_po_number = iv_po_number
                      iv_locale    = 'de_DE'
            IMPORTING ev_pdf       = rv_pdf ).
  ENDMETHOD.

  METHOD read_confirmation.
    DATA formdata TYPE xstring.

    " the fillable fields of the returned PDF as XML
    DATA(pdfobj) = cl_fp=>get_reference( )->create_pdf_object( ).
    pdfobj->set_document( pdfdata = iv_pdf ).
    pdfobj->set_extractdata( ).
    pdfobj->set_task_verifysignature( ).
    pdfobj->execute( ).
    pdfobj->get_data( IMPORTING formdata = formdata ).
    DATA(xml) = cl_abap_conv_codepage=>create_in( )->convert( formdata ).

    rs_confirmation = VALUE #( po_number   = iv_po_number
                               received_by = xml_value( iv_xml   = xml
                                                        iv_field = 'RECEIVED_BY' )
                               received_on = to_date( xml_value( iv_xml   = xml
                                                                 iv_field = 'RECEIVED_ON' ) )
                               complete    = xsdbool( xml_value( iv_xml   = xml
                                                                 iv_field = 'COMPLETE' ) = 'X' )
                               remark      = xml_value( iv_xml   = xml
                                                        iv_field = 'REMARK' )
                               is_signed   = xsdbool( pdfobj->get_signature_status( ) = 'V' ) ).
    IF rs_confirmation-is_signed = abap_true.
      rs_confirmation-signer = rs_confirmation-received_by.
    ENDIF.

    " the received quantity per item, compared with the ordered quantity
    SELECT ItemNo, Product, Quantity
      FROM zi_purchaseorderdocitem
      WHERE PONumber = @rs_confirmation-po_number
      ORDER BY ItemNo
      INTO TABLE @DATA(items).
    LOOP AT items INTO DATA(item).
      DATA(received) = to_quantity( xml_value( iv_xml   = xml
                                               iv_field = |RECEIVED_{ item-ItemNo }| ) ).
      APPEND VALUE #( item_no      = item-ItemNo
                      product      = item-Product
                      ordered_qty  = item-Quantity
                      received_qty = received
                      difference   = received - item-Quantity ) TO rs_confirmation-items.
    ENDLOOP.
  ENDMETHOD.

  METHOD save_confirmation.
    GET TIME STAMP FIELD DATA(now).
    DATA(header) = VALUE zpodoc_gr_a( po_number    = is_confirmation-po_number
                                      received_by  = is_confirmation-received_by
                                      received_on  = is_confirmation-received_on
                                      complete     = is_confirmation-complete
                                      remark       = is_confirmation-remark
                                      is_signed    = is_confirmation-is_signed
                                      signer       = is_confirmation-signer
                                      confirmed_at = now ).
    MODIFY zpodoc_gr_a FROM @header.
    DELETE FROM zpodoc_gritem_a WHERE po_number = @is_confirmation-po_number.
    DATA gr_items TYPE STANDARD TABLE OF zpodoc_gritem_a WITH EMPTY KEY.
    gr_items = VALUE #( FOR i IN is_confirmation-items
                        ( po_number    = is_confirmation-po_number
                          item_no      = i-item_no
                          received_qty = i-received_qty ) ).
    INSERT zpodoc_gritem_a FROM TABLE @gr_items.
  ENDMETHOD.

  METHOD xml_value.
    FIND FIRST OCCURRENCE OF PCRE |<{ to_upper( iv_field ) }>([^<]*)</| IN iv_xml SUBMATCHES rv_value.
    rv_value = replace( val  = rv_value
                        sub  = '&lt;'
                        with = '<'
                        occ  = 0 ).
    rv_value = replace( val  = rv_value
                        sub  = '&gt;'
                        with = '>'
                        occ  = 0 ).
    rv_value = replace( val  = rv_value
                        sub  = '&quot;'
                        with = '"'
                        occ  = 0 ).
    rv_value = replace( val  = rv_value
                        sub  = '&apos;'
                        with = `'`
                        occ  = 0 ).
    rv_value = replace( val  = rv_value
                        sub  = '&amp;'
                        with = '&'
                        occ  = 0 ).
  ENDMETHOD.

  METHOD to_quantity.
    DATA(text) = condense( val = iv_text
                           to  = `` ).
    IF text IS INITIAL.
      RETURN.
    ENDIF.
    text = translate( val  = text
                      from = ','
                      to   = '.' ).
    TRY.
        rv_qty = text.
      CATCH cx_sy_conversion_error.
        rv_qty = 0.
    ENDTRY.
  ENDMETHOD.

  METHOD to_date.
    DATA(text) = condense( iv_text ).
    IF matches( val   = text
                regex = `\d{2}\.\d{2}\.\d{4}` ).
      rv_date = |{ substring( val = text
                              off = 6
                              len = 4 ) }{ substring( val = text
                                                      off = 3
                                                      len = 2 ) }{ substring( val = text
                                                                              off = 0
                                                                              len = 2 ) }|.
    ELSEIF matches( val   = text
                    regex = `\d{2}/\d{2}/\d{4}` ).
      rv_date = |{ substring( val = text
                              off = 6
                              len = 4 ) }{ substring( val = text
                                                      off = 0
                                                      len = 2 ) }{ substring( val = text
                                                                              off = 3
                                                                              len = 2 ) }|.
    ELSEIF matches( val   = text
                    regex = `\d{4}-\d{2}-\d{2}` ).
      rv_date = |{ substring( val = text
                              off = 0
                              len = 4 ) }{ substring( val = text
                                                      off = 5
                                                      len = 2 ) }{ substring( val = text
                                                                              off = 8
                                                                              len = 2 ) }|.
    ENDIF.
  ENDMETHOD.

  METHOD simulate_filled_form.
    " In real life the warehouse fills in the PDF and sends it back. Here the values the warehouse would enter go
    " into the form data before rendering, and the warehouse key signs the signature field.
    DATA signed TYPE xstring.

    TRY.
        DATA(reader) = cl_fp_form_reader=>create_form_reader( 'ZGR_CONFIRMATION' ).
        DATA(fdp) = cl_fp_fdp_services=>get_instance( reader->get_fdp_name( ) ).
        DATA(keys) = fdp->get_keys( ).
        keys[ name = 'PONUMBER' ]-value = iv_po_number.
        DATA(xml) = cl_abap_conv_codepage=>create_in( )->convert( fdp->read_to_xml_v2( keys ) ).

        " what the warehouse enters: 10 memory modules short, a damaged carton
        xml = set_xml_value( iv_xml   = xml
                             iv_field = 'RECEIVEDBY'
                             iv_value = 'Markus Hoffmann' ).
        xml = set_xml_value( iv_xml   = xml
                             iv_field = 'RECEIVEDON'
                             iv_value = |{ cl_abap_context_info=>get_system_date( ) }| ).
        xml = set_xml_value( iv_xml   = xml
                             iv_field = 'ISCOMPLETE'
                             iv_value = '' ).
        xml = set_xml_value(
                  iv_xml   = xml
                  iv_field = 'REMARK'
                  iv_value = '10 memory modules RM12 missing (back order), 1 carton PK01 damaged on arrival.' ).
        SPLIT xml AT '<item>' INTO TABLE DATA(parts).
        LOOP AT parts ASSIGNING FIELD-SYMBOL(<part>) WHERE table_line CS '<PRODUCT>RM12</PRODUCT>'.
          DATA(ordered) = to_quantity( xml_value( iv_xml   = <part>
                                                  iv_field = 'QUANTITY' ) ).
          DATA(received) = CONV i( ordered - 10 ).
          <part> = set_xml_value( iv_xml   = <part>
                                  iv_field = 'RECEIVEDQUANTITY'
                                  iv_value = |{ received }| ).
        ENDLOOP.
        xml = concat_lines_of( table = parts
                               sep   = '<item>' ).

        cl_fp_ads_util=>render_pdf( EXPORTING iv_xdp_layout = reader->get_layout( )
                                              iv_xml_data   = cl_abap_conv_codepage=>create_out( )->convert( xml )
                                              iv_locale     = 'de_DE'
                                    IMPORTING ev_pdf        = DATA(filled) ).
      CATCH cx_fp_fdp_error
            cx_fp_ads_util
            cx_fp_form_reader.
        RETURN.
    ENDTRY.

    TRY.
        DATA(signer) = cl_fp=>get_reference( )->create_pdf_object( ).
        signer->set_document( pdfdata = filled ).
        signer->set_signature( keyname   = 'ZGR_WAREHOUSE'
                               fieldname = 'signature'
                               reason    = 'Goods received'
                               location  = 'Hamburg' ).
        signer->execute( ).
        signer->get_document( IMPORTING pdfdata = signed ).
        rv_pdf = signed.
      CATCH cx_fp_runtime_usage.
        rv_pdf = filled.   " no signing key: unsigned
    ENDTRY.
  ENDMETHOD.

  METHOD set_xml_value.
    DATA(value) = replace( val  = CONV string( iv_value )
                           sub  = '&'
                           with = '&amp;'
                           occ  = 0 ).
    value = replace( val  = value
                     sub  = '<'
                     with = '&lt;'
                     occ  = 0 ).
    value = replace( val  = value
                     sub  = '>'
                     with = '&gt;'
                     occ  = 0 ).
    rv_xml = replace( val  = iv_xml
                      pcre = |<{ iv_field }>[^<]*</{ iv_field }>|
                      with = |<{ iv_field }>{ value }</{ iv_field }>| ).
  ENDMETHOD.

  METHOD if_oo_adt_classrun~main.
    TRY.
        " 1. the purchase order: render and print
        render_po( EXPORTING iv_po_number = '4500001001'
                   IMPORTING ev_pdf       = DATA(pdf)
                             ev_pages     = DATA(pages) ).
        out->write( |Purchase order 4500001001: { pages } page(s), { xstrlen( pdf ) } bytes| ).
        out->write( |Printed: queue item { print_po( '4500001002' ) }| ).

        " 2. the goods receipt confirmation as it is sent to the warehouse (fillable)
        DATA(blank) = render_confirmation( '4500001002' ).
        out->write( |Goods receipt confirmation 4500001002 (fillable): { xstrlen( blank ) } bytes| ).
      CATCH cx_fp_fdp_error
            cx_fp_ads_util
            cx_fp_form_reader INTO DATA(error).
        out->write( |Error: { error->get_text( ) }| ).
        RETURN.
    ENDTRY.

    " 3. the confirmation comes back filled in and signed: read it and store the result
    TRY.
        DATA(conf) = read_confirmation( iv_po_number = '4500001002'
                                        iv_pdf       = simulate_filled_form( '4500001002' ) ).
      CATCH cx_fp_runtime_usage INTO DATA(read_error).
        out->write( |Cannot read the confirmation: { read_error->get_text( ) }| ).
        RETURN.
    ENDTRY.
    out->write( |Confirmation of purchase order { conf-po_number ALPHA = OUT }:| ).
    out->write( |  Received by { conf-received_by } on { conf-received_on DATE = ISO }| ).
    out->write( |  Complete: { COND #( WHEN conf-complete = abap_true THEN `yes` ELSE `no` ) }, | &&
                |signed: { COND #( WHEN conf-is_signed = abap_true THEN `yes (valid signature)` ELSE `no` ) }| ).
    out->write( |  Remark: { conf-remark }| ).
    LOOP AT conf-items INTO DATA(item).
      out->write(
          |  Item { item-item_no ALPHA = OUT } { item-product }: ordered { item-ordered_qty NUMBER = USER }, | &&
          |received { item-received_qty NUMBER = USER }| &&
          COND #( WHEN item-difference <> 0 THEN |, difference { item-difference NUMBER = USER }| ELSE `` ) ).
    ENDLOOP.
    save_confirmation( conf ).
    out->write( |Confirmation saved; a reprint of ZGR_CONFIRMATION shows the confirmed values.| ).
  ENDMETHOD.
ENDCLASS.
