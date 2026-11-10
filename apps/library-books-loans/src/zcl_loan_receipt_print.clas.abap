"! Prints the loan receipt with the Adobe form ZF_LOAN_RECEIPT (XDP layout, data provider ZFDP_LOAN_RECEIPT):
"! reads the open loan with the oldest due date, renders the PDF and puts it into the print queue.
CLASS zcl_loan_receipt_print DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES if_oo_adt_classrun.

  PRIVATE SECTION.
    CONSTANTS form_name  TYPE string VALUE 'ZF_LOAN_RECEIPT'.
    CONSTANTS queue_name TYPE string VALUE 'DEFAULT'.
ENDCLASS.


CLASS zcl_loan_receipt_print IMPLEMENTATION.
  METHOD if_oo_adt_classrun~main.
    " the loan to print: the open loan that is due longest, else the most recent loan
    SELECT FROM zi_loanreceipt
      FIELDS LoanUUID, BookTitle, MemberName, DueDate
      WHERE ReturnDate IS INITIAL
      ORDER BY DueDate ASCENDING
      INTO TABLE @DATA(open_loans)
      UP TO 1 ROWS.
    IF open_loans IS NOT INITIAL.
      DATA(loan) = open_loans[ 1 ].
    ELSE.
      SELECT FROM zi_loanreceipt
        FIELDS LoanUUID, BookTitle, MemberName, DueDate
        ORDER BY LoanDate DESCENDING
        INTO TABLE @DATA(any_loans)
        UP TO 1 ROWS.
      IF any_loans IS INITIAL.
        out->write( 'There is no loan to print' ).
        RETURN.
      ENDIF.
      loan = any_loans[ 1 ].
    ENDIF.
    out->write( |Loan: "{ loan-BookTitle }" borrowed by { loan-MemberName }, due { loan-DueDate DATE = ISO }| ).

    TRY.
        DATA(form) = cl_fp_form_reader=>create_form_reader( form_name ).
        DATA(fdp_util) = cl_fp_fdp_services=>get_instance( iv_service_definition = form->get_fdp_name( ) ).

        DATA(select_keys) = fdp_util->get_keys( ).
        select_keys[ name = 'LOANUUID' ]-value = loan-LoanUUID.

        DATA(xml) = fdp_util->read_to_xml_v2( it_select = select_keys ).

        cl_fp_ads_util=>render_pdf( EXPORTING iv_locale     = 'en_US'
                                              iv_xml_data   = xml
                                              iv_xdp_layout = form->get_layout( )
                                              is_options    = VALUE #( embed_fonts = form->get_font_embed( )
                                                                       trace_level = 4 )
                                    IMPORTING ev_pdf          = DATA(pdf)
                                              ev_pages        = DATA(pages)
                                              ev_trace_string = DATA(trace) ).
        out->write( |Receipt rendered: { pages } page(s), { xstrlen( pdf ) } bytes| ).
        IF trace IS NOT INITIAL.
          out->write( trace ).
        ENDIF.

        " print data (PDL) for the queue and the queue item
        cl_fp_ads_util=>render_4_pq( EXPORTING iv_pq_name    = queue_name
                                               iv_locale     = 'en_US'
                                               iv_xml_data   = xml
                                               iv_xdp_layout = form->get_layout( )
                                               is_options    = VALUE #( trace_level = 0 )
                                     IMPORTING ev_pdl        = DATA(pdl) ).
        DATA(item) = cl_print_queue_utils=>create_queue_item_by_data( iv_qname            = queue_name
                                                                      iv_print_data       = pdl
                                                                      iv_name_of_main_doc = |Loan receipt { loan-MemberName }| ).
        out->write( |Print queue { queue_name }: item { item }| ).
      CATCH cx_fp_fdp_error cx_fp_form_reader cx_fp_ads_util INTO DATA(error).
        out->write( |Error: { error->get_text( ) }| ).
    ENDTRY.
  ENDMETHOD.
ENDCLASS.
