CLASS zcl_form_demo DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    TYPES: BEGIN OF ty_line,
             description TYPE string,
             quantity    TYPE i,
             amount      TYPE p LENGTH 13 DECIMALS 2,
           END OF ty_line,
           tt_lines TYPE STANDARD TABLE OF ty_line WITH EMPTY KEY.
    TYPES: BEGIN OF ty_invoice,
             invoiceid   TYPE string,
             customer    TYPE string,
             invoicedate TYPE d,
             currency    TYPE string,
             _item       TYPE tt_lines,
           END OF ty_invoice.
    CLASS-METHODS cloud RETURNING VALUE(rv) TYPE string.
    CLASS-METHODS classic RETURNING VALUE(rv) TYPE string.
    CLASS-METHODS queue RETURNING VALUE(rv) TYPE string.
    CLASS-METHODS spool RETURNING VALUE(rv) TYPE string.
    CLASS-METHODS labels RETURNING VALUE(rv) TYPE string.
    CLASS-METHODS short RETURNING VALUE(rv) TYPE string.
    CLASS-METHODS interactive RETURNING VALUE(rv) TYPE string.
    CLASS-METHODS archive RETURNING VALUE(rv) TYPE string.
ENDCLASS.

CLASS zcl_form_demo IMPLEMENTATION.
  METHOD cloud.
    " SAP's sample: form reader, data provider keys, XML, render_pdf
    DATA(form) = cl_fp_form_reader=>create_form_reader( 'ZINVOICE' ).
    DATA(fdp) = cl_fp_fdp_services=>get_instance( form->get_fdp_name( ) ).
    DATA(keys) = fdp->get_keys( ).
    keys[ name = 'INVOICEID' ]-value = '0000000042'.
    DATA(xml) = fdp->read_to_xml_v2( keys ).
    cl_fp_ads_util=>render_pdf( EXPORTING iv_xdp_layout = form->get_layout( )
                                          iv_xml_data   = xml
                                          iv_locale     = 'de_DE'
                                          is_options    = VALUE #( trace_level = 4 )
                                IMPORTING ev_pdf        = DATA(pdf)
                                          ev_pages      = DATA(pages)
                                          ev_trace_string = DATA(trace) ).
    DATA(text) = cl_abap_conv_codepage=>create_in( )->convert( xml ).
    rv = |{ form->get_fdp_name( ) }/{ lines( keys ) }/{ xsdbool( xstrlen( pdf ) > 1000 ) }/{ pages }/{ xsdbool( text CS '<DESCRIPTION>Mouse</DESCRIPTION>' ) }/{ xsdbool( trace IS NOT INITIAL ) }|.
  ENDMETHOD.

  METHOD classic.
    DATA fm_name TYPE rs38l_fnam.
    DATA outputparams TYPE sfpoutputparams.
    DATA docparams TYPE sfpdocparams.
    DATA formoutput TYPE fpformoutput.
    DATA invoice TYPE ty_invoice.
    invoice = VALUE #( invoiceid = '0000000042' customer = 'Driver program' invoicedate = '20261104' currency = 'EUR'
                       _item = VALUE #( ( description = 'Service' quantity = 3 amount = '150.00' ) ) ).
    outputparams-getpdf = abap_true.
    CALL FUNCTION 'FP_JOB_OPEN' CHANGING ie_outputparams = outputparams EXCEPTIONS OTHERS = 4.
    CALL FUNCTION 'FP_FUNCTION_MODULE_NAME' EXPORTING i_name = 'ZINVOICE' IMPORTING e_funcname = fm_name.
    docparams-langu = 'E'.
    CALL FUNCTION fm_name
      EXPORTING /1bcdwb/docparams  = docparams
                is_invoice         = invoice
      IMPORTING /1bcdwb/formoutput = formoutput
      EXCEPTIONS usage_error = 1 system_error = 2 internal_error = 3.
    DATA(subrc) = sy-subrc.
    CALL FUNCTION 'FP_JOB_CLOSE' EXCEPTIONS OTHERS = 4.
    rv = |{ fm_name }/{ subrc }/{ formoutput-pages }/{ xsdbool( xstrlen( formoutput-pdf ) > 1000 ) }|.
  ENDMETHOD.

  METHOD archive.
    " PDF/A from the classic interface (outputparams-pdftype) and from ZCL_RAP_FORM; a password-protected PDF
    DATA fm_name TYPE rs38l_fnam.
    DATA outputparams TYPE sfpoutputparams.
    DATA docparams TYPE sfpdocparams.
    DATA formoutput TYPE fpformoutput.
    DATA invoice TYPE ty_invoice.
    invoice = VALUE #( invoiceid = '0000000043' customer = 'Archive' invoicedate = '20261104' currency = 'EUR' ).
    outputparams-getpdf = abap_true.
    outputparams-pdftype = 'A'.
    CALL FUNCTION 'FP_JOB_OPEN' CHANGING ie_outputparams = outputparams EXCEPTIONS OTHERS = 4.
    CALL FUNCTION 'FP_FUNCTION_MODULE_NAME' EXPORTING i_name = 'ZINVOICE' IMPORTING e_funcname = fm_name.
    CALL FUNCTION fm_name
      EXPORTING /1bcdwb/docparams  = docparams
                is_invoice         = invoice
      IMPORTING /1bcdwb/formoutput = formoutput
      EXCEPTIONS usage_error = 1 system_error = 2 internal_error = 3.
    CALL FUNCTION 'FP_JOB_CLOSE' EXCEPTIONS OTHERS = 4.
    DATA(marker) = cl_abap_conv_codepage=>create_out( )->convert( `pdfaid:part` ).
    FIND marker IN formoutput-pdf IN BYTE MODE.
    DATA(classic_pdfa) = xsdbool( sy-subrc = 0 ).
    DATA(pdf) = zcl_rap_form=>render( iv_form = 'ZINVOICE' is_data = invoice iv_pdfa = abap_true ).
    FIND marker IN pdf IN BYTE MODE.
    DATA(short_pdfa) = xsdbool( sy-subrc = 0 ).
    DATA(secret) = zcl_rap_form=>render( iv_form = 'ZAPPROVAL' is_data = VALUE ty_invoice( invoiceid = '9' customer = 'Locked' )
                                         iv_password = 'open sesame' iv_permissions = 'print,fill' ).
    DATA(fields) = zcl_rap_form=>read_fields( iv_pdf = secret ).
    DATA(without) = sy-subrc.
    fields = zcl_rap_form=>read_fields( iv_pdf = secret iv_password = 'open sesame' ).
    rv = |{ classic_pdfa }/{ short_pdfa }/{ without }/{ sy-subrc }/{ xsdbool( lines( fields ) > 0 ) }|.
  ENDMETHOD.

  METHOD queue.
    DATA(pdf) = zcl_rap_form=>render( iv_form = 'ZINVOICE' is_data = VALUE ty_invoice( invoiceid = '7' customer = 'Q' currency = 'EUR' ) ).
    DATA(item) = cl_print_queue_utils=>create_queue_item_by_data( iv_qname = 'INVOICES' iv_print_data = pdf iv_name_of_main_doc = 'Invoice 7' ).
    rv = |{ xsdbool( item IS NOT INITIAL ) }|.
  ENDMETHOD.

  METHOD spool.
    " a job with two invoices: one output request (queue LBL1, 2 copies) with both forms in one PDF
    DATA fm_name TYPE rs38l_fnam.
    DATA outputparams TYPE sfpoutputparams.
    DATA docparams TYPE sfpdocparams.
    DATA formoutput TYPE fpformoutput.
    DATA result TYPE sfpjoboutput.
    outputparams-dest = 'LBL1'.
    outputparams-copies = 2.
    outputparams-covtitle = 'Two invoices'.
    CALL FUNCTION 'FP_JOB_OPEN' CHANGING ie_outputparams = outputparams EXCEPTIONS OTHERS = 4.
    CALL FUNCTION 'FP_FUNCTION_MODULE_NAME' EXPORTING i_name = 'ZINVOICE' IMPORTING e_funcname = fm_name.
    CALL FUNCTION fm_name
      EXPORTING /1bcdwb/docparams  = docparams
                is_invoice         = VALUE ty_invoice( invoiceid = '51' customer = 'First' currency = 'EUR' )
      IMPORTING /1bcdwb/formoutput = formoutput.
    CALL FUNCTION fm_name
      EXPORTING /1bcdwb/docparams  = docparams
                is_invoice         = VALUE ty_invoice( invoiceid = '52' customer = 'Second' currency = 'EUR' )
      IMPORTING /1bcdwb/formoutput = formoutput.
    CALL FUNCTION 'FP_JOB_CLOSE' IMPORTING e_result = result EXCEPTIONS OTHERS = 4.
    rv = |{ lines( result-spoolids ) }/{ result-spoolids[ 1 ] }|.
  ENDMETHOD.

  METHOD labels.
    " print data for a label printer (ZPL) and PostScript; the queue items keep the PDF for the preview
    DATA(reader) = cl_fp_form_reader=>create_form_reader( 'ZINVOICE' ).
    DATA(fdp) = cl_fp_fdp_services=>get_instance( reader->get_fdp_name( ) ).
    DATA(keys) = fdp->get_keys( ).
    keys[ name = 'INVOICEID' ]-value = '0000000042'.
    cl_fp_ads_util=>render_4_pq( EXPORTING iv_pq_name    = 'LABELS'
                                           iv_xml_data   = fdp->read_to_xml_v2( keys )
                                           iv_xdp_layout = reader->get_layout( )
                                           is_options    = VALUE #( pdl = 'ZPL' )
                                 IMPORTING ev_pdl        = DATA(zpl) ).
    DATA(text) = cl_abap_conv_codepage=>create_in( )->convert( zpl ).
    DATA(item) = cl_print_queue_utils=>create_queue_item_by_data( iv_qname = 'LABELS' iv_print_data = zpl iv_name_of_main_doc = 'Label' ).
    rv = |{ xsdbool( text CP '^XA*^XZ*' ) }/{ item }|.
  ENDMETHOD.

  METHOD short.
    DATA(request) = zcl_rap_form=>print( iv_form = 'ZINVOICE' is_data = VALUE ty_invoice( invoiceid = '8' customer = 'Print' currency = 'EUR' ) iv_title = 'Invoice 8' ).
    rv = |{ xsdbool( request > 0 ) }/{ sy-subrc }|.
  ENDMETHOD.

  METHOD interactive.
    " an interactive form: render it fillable, read the field values back (as a filled form would come back),
    " sign its signature field, check the signature
    TYPES: BEGIN OF ty_request,
             requester TYPE string,
             amount    TYPE p LENGTH 13 DECIMALS 2,
             remark    TYPE string,
             urgent    TYPE abap_bool,
           END OF ty_request.
    DATA fm_name TYPE rs38l_fnam.
    DATA outputparams TYPE sfpoutputparams.
    DATA docparams TYPE sfpdocparams.
    DATA formoutput TYPE fpformoutput.
    DATA xml TYPE xstring.
    DATA signed TYPE xstring.
    outputparams-getpdf = abap_true.
    CALL FUNCTION 'FP_JOB_OPEN' CHANGING ie_outputparams = outputparams EXCEPTIONS OTHERS = 4.
    CALL FUNCTION 'FP_FUNCTION_MODULE_NAME' EXPORTING i_name = 'ZAPPROVAL' IMPORTING e_funcname = fm_name.
    docparams-fillable = abap_true.
    CALL FUNCTION fm_name
      EXPORTING /1bcdwb/docparams  = docparams
                is_request         = VALUE ty_request( requester = 'ALICE' amount = '1200.00' remark = 'Trip to Walldorf' urgent = abap_true )
      IMPORTING /1bcdwb/formoutput = formoutput
      EXCEPTIONS OTHERS = 1.
    CALL FUNCTION 'FP_JOB_CLOSE' EXCEPTIONS OTHERS = 4.

    DATA(fp) = cl_fp=>get_reference( ).
    DATA(pdfobj) = fp->create_pdf_object( connection = 'ADS' ).
    pdfobj->set_document( pdfdata = formoutput-pdf ).
    pdfobj->set_extractdata( ).
    pdfobj->execute( ).
    pdfobj->get_data( IMPORTING formdata = xml ).
    DATA(text) = cl_abap_conv_codepage=>create_in( )->convert( xml ).

    DATA(fields) = zcl_rap_form=>read_fields( formoutput-pdf ).
    DATA(remark) = fields[ name = 'remark' ]-value.

    DATA(signer) = fp->create_pdf_object( ).
    signer->set_document( pdfdata = formoutput-pdf ).
    signer->set_signature( keyname = 'ZAPPROVER' fieldname = 'approval' reason = 'Approved' location = 'Walldorf' ).
    signer->execute( ).
    signer->get_document( IMPORTING pdfdata = signed ).
    signer->set_document( pdfdata = signed ).
    signer->set_task_verifysignature( ).
    signer->execute( ).

    TRY.
        DATA(nokey) = fp->create_pdf_object( ).
        nokey->set_document( pdfdata = formoutput-pdf ).
        nokey->set_signature( keyname = 'NOSUCHKEY' fieldname = 'approval' ).
        nokey->execute( ).
        DATA(err) = `no error`.
      CATCH cx_fp_runtime_usage INTO DATA(x).
        err = `error`.
    ENDTRY.
    rv = |{ xsdbool( text CS '<REMARK>Trip to Walldorf</REMARK>' ) }/{ xsdbool( text CS '<URGENT>X</URGENT>' ) }/{ remark }/{ signer->get_signature_status( ) }/{ err }|.
  ENDMETHOD.
ENDCLASS.
