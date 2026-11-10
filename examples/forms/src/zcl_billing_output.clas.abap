"! Output of billing documents with SAP's form APIs (run it as a console class: rap run . zcl_billing_output)
"! - render_cloud: ABAP Cloud (form reader, form data provider, Adobe Document Services render_pdf)
"! - print: the PDF into the print queue
"! - render_classic: the classic interface (FP_JOB_OPEN, generated function module, FP_JOB_CLOSE)
"! - confirm: an interactive form: render it fillable, read the filled fields back, sign it
CLASS zcl_billing_output DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES if_oo_adt_classrun.
    TYPES: BEGIN OF ty_item,
             itemno      TYPE n LENGTH 6,
             category    TYPE string,
             material    TYPE string,
             description TYPE string,
             quantity    TYPE p LENGTH 13 DECIMALS 3,
             unit        TYPE string,
             unitprice   TYPE p LENGTH 13 DECIMALS 2,
           END OF ty_item,
           tt_items TYPE STANDARD TABLE OF ty_item WITH EMPTY KEY,
           BEGIN OF ty_billing_doc,
             billingdoc   TYPE n LENGTH 10,
             status       TYPE c LENGTH 1,
             customername TYPE string,
             street       TYPE string,
             postalcode   TYPE string,
             city         TYPE string,
             country      TYPE string,
             billingdate  TYPE d,
             duedate      TYPE d,
             currency     TYPE string,
             taxrate      TYPE p LENGTH 5 DECIMALS 2,
             _item        TYPE tt_items,
           END OF ty_billing_doc.
    "! the PDF of a billing document (ABAP Cloud)
    CLASS-METHODS render_cloud
      IMPORTING iv_billing_doc TYPE csequence
                iv_locale      TYPE csequence DEFAULT 'de_DE'
      EXPORTING ev_pdf         TYPE xstring
                ev_pages       TYPE i
      RAISING   cx_fp_fdp_error cx_fp_ads_util cx_fp_form_reader.
    "! prints a billing document: the print queue item
    CLASS-METHODS print
      IMPORTING iv_billing_doc TYPE csequence
      RETURNING VALUE(rv_item) TYPE string
      RAISING   cx_fp_fdp_error cx_fp_ads_util cx_fp_form_reader.
    "! the PDF from data the program collects itself (classic interface)
    CLASS-METHODS render_classic
      IMPORTING is_doc        TYPE ty_billing_doc
      RETURNING VALUE(rv_pdf) TYPE xstring.
ENDCLASS.

CLASS zcl_billing_output IMPLEMENTATION.
  METHOD render_cloud.
    DATA(reader) = cl_fp_form_reader=>create_form_reader( 'ZBILLING_DOC' ).
    DATA(fdp) = cl_fp_fdp_services=>get_instance( reader->get_fdp_name( ) ).
    DATA(keys) = fdp->get_keys( ).
    keys[ name = 'BILLINGDOC' ]-value = iv_billing_doc.
    DATA(xml) = fdp->read_to_xml_v2( keys ).
    cl_fp_ads_util=>render_pdf( EXPORTING iv_xdp_layout = reader->get_layout( )
                                          iv_xml_data   = xml
                                          iv_locale     = iv_locale
                                IMPORTING ev_pdf        = ev_pdf
                                          ev_pages      = ev_pages ).
  ENDMETHOD.

  METHOD print.
    render_cloud( EXPORTING iv_billing_doc = iv_billing_doc IMPORTING ev_pdf = DATA(pdf) ).
    rv_item = cl_print_queue_utils=>create_queue_item_by_data( iv_qname            = 'INVOICES'
                                                               iv_print_data       = pdf
                                                               iv_name_of_main_doc = |Invoice { iv_billing_doc }| ).
  ENDMETHOD.

  METHOD render_classic.
    DATA fm_name TYPE rs38l_fnam.
    DATA outputparams TYPE sfpoutputparams.
    DATA docparams TYPE sfpdocparams.
    DATA formoutput TYPE fpformoutput.
    outputparams-getpdf = abap_true.
    CALL FUNCTION 'FP_JOB_OPEN' CHANGING ie_outputparams = outputparams EXCEPTIONS OTHERS = 1.
    CALL FUNCTION 'FP_FUNCTION_MODULE_NAME' EXPORTING i_name = 'ZBILLING_DOC' IMPORTING e_funcname = fm_name.
    docparams-langu = 'E'.
    docparams-country = 'GB'.
    CALL FUNCTION fm_name
      EXPORTING /1bcdwb/docparams  = docparams
                is_doc             = is_doc
      IMPORTING /1bcdwb/formoutput = formoutput
      EXCEPTIONS OTHERS = 1.
    CALL FUNCTION 'FP_JOB_CLOSE' EXCEPTIONS OTHERS = 1.
    rv_pdf = formoutput-pdf.
  ENDMETHOD.

  METHOD if_oo_adt_classrun~main.
    TRY.
        render_cloud( EXPORTING iv_billing_doc = '0090000001' IMPORTING ev_pdf = DATA(pdf) ev_pages = DATA(pages) ).
        out->write( |Invoice 90000001 (ABAP Cloud): { pages } page(s), { xstrlen( pdf ) } bytes| ).
        out->write( |Printed: queue item { print( '0090000002' ) }| ).
      CATCH cx_fp_fdp_error cx_fp_ads_util cx_fp_form_reader INTO DATA(error).
        out->write( |Error: { error->get_text( ) }| ).
    ENDTRY.

    DATA(classic) = render_classic( VALUE #( billingdoc = '0090000003' status = 'F' customername = 'Program data Ltd' city = 'Leeds'
                                             billingdate = '20261104' duedate = '20261204' currency = 'GBP' taxrate = '20'
                                             _item = VALUE #( ( itemno = '000010' category = 'Services' description = 'Consulting'
                                                                quantity = '2' unit = 'DAY' unitprice = '950.00' ) ) ) ).
    out->write( |Invoice 90000003 (classic interface): { xstrlen( classic ) } bytes| ).

    " an interactive form: fillable, read back, signed
    DATA fm_name TYPE rs38l_fnam.
    DATA outputparams TYPE sfpoutputparams.
    DATA docparams TYPE sfpdocparams.
    DATA formoutput TYPE fpformoutput.
    DATA formdata TYPE xstring.
    DATA signed TYPE xstring.
    outputparams-getpdf = abap_true.
    CALL FUNCTION 'FP_JOB_OPEN' CHANGING ie_outputparams = outputparams EXCEPTIONS OTHERS = 1.
    CALL FUNCTION 'FP_FUNCTION_MODULE_NAME' EXPORTING i_name = 'ZDELIVERY_CONF' IMPORTING e_funcname = fm_name.
    docparams-fillable = abap_true.
    CALL FUNCTION fm_name
      EXPORTING /1bcdwb/docparams  = docparams
                billingdoc         = '0090000001'
                customername       = 'Schmidt Maschinenbau GmbH'
                received_by        = 'K. Schmidt'
                complete           = abap_true
      IMPORTING /1bcdwb/formoutput = formoutput
      EXCEPTIONS OTHERS = 1.
    CALL FUNCTION 'FP_JOB_CLOSE' EXCEPTIONS OTHERS = 1.

    DATA(pdfobj) = cl_fp=>get_reference( )->create_pdf_object( ).
    pdfobj->set_document( pdfdata = formoutput-pdf ).
    pdfobj->set_extractdata( ).
    pdfobj->execute( ).
    pdfobj->get_data( IMPORTING formdata = formdata ).
    out->write( |Delivery confirmation, filled fields:| ).
    LOOP AT zcl_rap_form=>read_fields( formoutput-pdf ) INTO DATA(field).
      out->write( |  { field-name } = { field-value }| ).
    ENDLOOP.

    TRY.
        pdfobj->set_signature( keyname = 'ZBILLING' fieldname = 'signature' reason = 'Delivery confirmed' location = 'Walldorf' ).
        pdfobj->execute( ).
        pdfobj->get_document( IMPORTING pdfdata = signed ).
        out->write( |Signed: { xstrlen( signed ) } bytes| ).
      CATCH cx_fp_runtime_usage INTO DATA(sign_error).
        out->write( |Not signed: { sign_error->get_text( ) }| ).
    ENDTRY.

    " archiving (PDF/A-2b) and a copy for the customer that needs a password and cannot be changed
    DATA(doc) = VALUE ty_billing_doc( billingdoc = '0090000004' status = 'P' customername = 'Archive AG' city = 'Berlin'
                                      billingdate = '20261104' duedate = '20261204' currency = 'EUR' taxrate = '19'
                                      _item = VALUE #( ( itemno = '000010' category = 'Hardware' description = 'Notebook'
                                                         quantity = '1' unit = 'PC' unitprice = '1249.00' ) ) ).
    DATA(archived) = zcl_rap_form=>render( iv_form = 'ZBILLING_DOC' is_data = doc iv_pdfa = abap_true ).
    out->write( |Invoice 90000004 as PDF/A: { xstrlen( archived ) } bytes| ).
    DATA(protected) = zcl_rap_form=>render( iv_form = 'ZBILLING_DOC' is_data = doc iv_password = '90000004'
                                            iv_owner_password = 'acme-admin' iv_permissions = 'print' ).
    out->write( |Invoice 90000004 with a password: { xstrlen( protected ) } bytes| ).
  ENDMETHOD.
ENDCLASS.
